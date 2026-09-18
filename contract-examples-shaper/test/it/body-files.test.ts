import { MicrocksContainer, type StartedMicrocksContainer } from '@microcks/microcks-testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import { MicrocksClient } from '../../src/lib/microcks/client';
import { buildPlan, leavesOfContract, type Mode } from '../../src/lib/plan';
import { runPlan, type StepOutcome } from '../../src/lib/runner';
import { pickedFolder } from '../unit/support';

/**
 * A picked folder holding a contract and response bodies under `v1/`: the shaper turns the bodies into an
 * APIExamples artifact, loads it next to the contract, and Microcks serves them.
 */
describe('a folder of response bodies', () => {
  let microcks: StartedMicrocksContainer;
  let client: MicrocksClient;

  const catalog = buildCatalog(pickedFolder('bodies'));
  const contract = catalog.contracts[0];

  beforeAll(async () => {
    microcks = await new MicrocksContainer(process.env.MICROCKS_IMAGE ?? 'quay.io/microcks/microcks-uber:latest').start();
    client = new MicrocksClient({ url: microcks.getHttpEndpoint() });
  });

  afterAll(async () => {
    await microcks?.stop();
  });

  const mock = (path: string) => fetch(`${microcks.getHttpEndpoint()}/rest/Pet%20Shop%20API/v1${path}`);

  async function apply(mode: Mode, selected: string[]) {
    const plan = buildPlan({ catalog, live: await client.liveState(), mode, selected: new Set(selected), appliedFiles: new Set() });
    const outcomes: StepOutcome[] = [];
    await runPlan(plan, client, (i, o) => (outcomes[i] = o));
    expect(outcomes.filter((o) => o.status !== 'done')).toEqual([]);
    return plan;
  }

  it('loads the bodies as examples of the contract they sit under', async () => {
    const plan = await apply('load', leavesOfContract(contract));
    expect(plan.steps.map((s) => s.type === 'upload' && `${s.artifactName} ${s.mainArtifact}`)).toEqual([
      'petshop.openapi.json true',
      'pet-shop-api-v1-body-files.yaml false',
    ]);

    const [service] = (await client.liveState()).services;
    expect(service.messages.map((m) => `${m.operation} ${m.example} ${m.sourceArtifact}`).sort()).toEqual([
      'GET /pets all-pets pet-shop-api-v1-body-files.yaml',
      'GET /pets available-pets pet-shop-api-v1-body-files.yaml',
      'GET /pets sold-pets pet-shop-api-v1-body-files.yaml',
      'GET /pets/{id} unknown-pet pet-shop-api-v1-body-files.yaml',
    ]);

    // The file's content, served as the response it names.
    const pets = await mock('/pets');
    expect(pets.status).toBe(200);
    expect(await pets.json()).toHaveLength(4);
    const unknown = await mock('/pets/999');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ title: 'Pet not found' });
  });

  it('unloads one example by leaving it out of the same artifact', async () => {
    const generated = contract.files.find((f) => f.file.origin === 'generated')!;
    const soldPets = generated.examples.find((e) => e.example === 'sold-pets')!;
    const { exampleLeaf } = await import('../../src/lib/plan');

    await apply('unload', [exampleLeaf(generated.file.path, soldPets)]);

    const [service] = (await client.liveState()).services;
    expect(service.messages.map((m) => m.example).sort()).toEqual(['all-pets', 'available-pets', 'unknown-pet']);
    expect((await mock('/pets')).status).toBe(200);
  });
});
