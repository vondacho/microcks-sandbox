import { MicrocksContainer, type StartedMicrocksContainer } from '@microcks/microcks-testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import { draftIssues, hasErrors, newDraft, type Draft } from '../../src/lib/design/draft';
import { designContract, type DesignContract } from '../../src/lib/design/operations';
import { packageDrafts } from '../../src/lib/design/package';
import { SchemaValidator } from '../../src/lib/design/schema';
import { MicrocksClient } from '../../src/lib/microcks/client';
import { buildPlan, leavesOfContract, leavesOfFile, type Mode } from '../../src/lib/plan';
import { runPlan, type StepOutcome } from '../../src/lib/runner';
import type { Catalog } from '../../src/lib/artifacts/catalog';
import { fixture } from '../unit/support';

/**
 * I design, I package, then I load: examples designed for a contract that has none are packaged as APIExamples,
 * loaded next to the contract, and served by Microcks as designed.
 */
describe('designing examples for a contract without any', () => {
  let microcks: StartedMicrocksContainer;
  let client: MicrocksClient;

  const contract = fixture('openapi.json');
  const design = designContract(buildCatalog([contract]).contracts[0]) as DesignContract;
  const validator = new SchemaValidator(design.document, design.openapi);
  const op = (name: string) => design.operations.find((o) => o.name === name)!;

  beforeAll(async () => {
    microcks = await new MicrocksContainer(process.env.MICROCKS_IMAGE ?? 'quay.io/microcks/microcks-uber:latest').start();
    client = new MicrocksClient({ url: microcks.getHttpEndpoint() });
  });

  afterAll(async () => {
    await microcks?.stop();
  });

  async function apply(catalog: Catalog, mode: Mode, selected: string[]) {
    const plan = buildPlan({ catalog, live: await client.liveState(), mode, selected: new Set(selected), appliedFiles: new Set() });
    const outcomes: StepOutcome[] = [];
    await runPlan(plan, client, (i, o) => (outcomes[i] = o));
    expect(outcomes.filter((o) => o.status !== 'done')).toEqual([]);
    return plan;
  }

  const mock = (path: string, init?: RequestInit) => fetch(`${microcks.getHttpEndpoint()}/rest/Pet%20Shop%20API/v1${path}`, init);

  function designed(): Draft[] {
    const luna = newDraft(design, op('GET /api/pets/{id}'), 'luna');
    luna.request.parameters.id = '7';
    luna.response.body = JSON.stringify({ id: 7, name: 'Luna', category: 'CAT', status: 'AVAILABLE', price: 150 });

    const invalid = newDraft(design, op('POST /api/pets'), 'invalid_pet');
    invalid.request.body = JSON.stringify({ name: '', category: 'DOG', status: 'AVAILABLE', price: -1 });
    invalid.response.status = '400';
    invalid.response.body = JSON.stringify({ status: 400, error: 'Bad Request', path: '/api/pets' });

    for (const draft of [luna, invalid]) {
      const issues = draftIssues(draft, op(draft.operation), { design, validator, siblings: [draft], existing: [] });
      expect(hasErrors(issues), JSON.stringify(issues)).toBe(false);
    }
    return [luna, invalid];
  }

  it('loads the contract, which has no examples to serve', async () => {
    await apply(buildCatalog([contract]), 'load', leavesOfContract(buildCatalog([contract]).contracts[0]));
    const [service] = (await client.liveState()).services;
    expect(service).toMatchObject({ name: 'Pet Shop API', version: 'v1', messages: [] });
    expect((await mock('/api/pets/7')).status).not.toBe(200);
  });

  it('serves the designed examples once their package is loaded', async () => {
    const file = packageDrafts(design, designed());
    const catalog = buildCatalog([contract, { path: file.fileName, name: file.fileName, content: file.content, origin: 'folder' }]);
    const packaged = catalog.contracts[0].files.find((f) => f.file.name === file.fileName)!;
    expect(packaged).toMatchObject({ kind: 'apiexamples', role: 'secondary' });

    const plan = await apply(catalog, 'load', leavesOfFile(packaged));
    expect(plan.steps.map((s) => s.type === 'upload' && `${s.artifactName} ${s.mainArtifact}`)).toEqual([`${file.fileName} false`]);

    const [service] = (await client.liveState()).services;
    expect(service.messages.map((m) => `${m.operation} ${m.example} ${m.sourceArtifact}`).sort()).toEqual([
      `GET /api/pets/{id} luna ${file.fileName}`,
      `POST /api/pets invalid_pet ${file.fileName}`,
    ]);

    const luna = await mock('/api/pets/7');
    expect(luna.status).toBe(200);
    expect(await luna.json()).toEqual({ id: 7, name: 'Luna', category: 'CAT', status: 'AVAILABLE', price: 150 });

    const invalid = await mock('/api/pets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: '', category: 'DOG', status: 'AVAILABLE', price: -1 }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'Bad Request' });
  });
});
