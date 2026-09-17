import { MicrocksContainer, type StartedMicrocksContainer } from '@microcks/microcks-testcontainers';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCatalog, type Catalog } from '../../src/lib/artifacts/catalog';
import { MicrocksClient } from '../../src/lib/microcks/client';
import type { JournalRecord } from '../../src/lib/microcks/journal';
import { liveServiceId } from '../../src/lib/microcks/live-state';
import { buildPlan, exampleLeaf, leavesOfContract, mergeApplied, type Mode } from '../../src/lib/plan';
import { runPlan, type StepOutcome } from '../../src/lib/runner';
import { previewFromArtifact } from '../../src/lib/preview';
import { buildView } from '../../src/lib/view';
import { fixture } from '../unit/support';

/**
 * The shaper against a real Microcks: plans are built from the fixtures and run through the same client the app's
 * API routes use, and what Microcks then holds, and serves as mocks, is checked.
 */
describe('loading and unloading into Microcks', () => {
  let microcks: StartedMicrocksContainer;
  let client: MicrocksClient;
  let applied = new Set<string>();
  const journal: JournalRecord[] = [];

  const catalog: Catalog = buildCatalog(
    ['openapi-including-examples.json', 'petshop-behavior-collection.json', 'petshop-examples.yaml', 'petshop-metadata.yaml'].map(fixture),
  );
  const petshop = catalog.contracts[0];
  const openapi = petshop.files.find((f) => f.kind === 'openapi')!;

  beforeAll(async () => {
    microcks = await new MicrocksContainer(process.env.MICROCKS_IMAGE ?? 'quay.io/microcks/microcks-uber:latest').start();
    client = new MicrocksClient({ url: microcks.getHttpEndpoint(), onCall: (record) => journal.push(record) });
  });

  afterAll(async () => {
    await microcks?.stop();
  });

  async function apply(mode: Mode, selected: string[]) {
    const plan = buildPlan({ catalog, live: await client.liveState(), mode, selected: new Set(selected), appliedFiles: applied });
    const outcomes: StepOutcome[] = [];
    const succeeded = await runPlan(plan, client, (i, outcome) => (outcomes[i] = outcome));
    expect(outcomes.filter((o) => o.status !== 'done')).toEqual([]);
    applied = mergeApplied(applied, plan, succeeded);
    return plan;
  }

  const examplesInMicrocks = async () =>
    (await client.liveState()).services.flatMap((s) => s.messages.map((m) => `${m.operation} ${m.example} ${m.sourceArtifact}`)).sort();

  const mock = (path: string) => fetch(`${microcks.getHttpEndpoint()}/rest/Pet%20Shop%20API/v1${path}`);

  it('loads the whole contract with its companions', async () => {
    const plan = await apply('load', leavesOfContract(petshop));
    expect(plan.steps.map((s) => s.type === 'upload' && s.artifactName)).toEqual([
      'openapi-including-examples.json',
      'petshop-behavior-collection.json',
      'petshop-examples.yaml',
      'petshop-metadata.yaml',
    ]);

    expect(await examplesInMicrocks()).toEqual(
      expect.arrayContaining([
        'PUT /api/pets/{id} sell_bella openapi-including-examples.json',
        'GET /api/pets/{id} luna petshop-examples.yaml',
      ]),
    );
    expect((await mock('/api/pets/7')).status).toBe(200);
  });

  it('unloads a single example and leaves every other one in place', async () => {
    const before = await examplesInMicrocks();
    const sellBella = openapi.examples.find((e) => e.example === 'sell_bella')!;

    await apply('unload', [exampleLeaf(openapi.file.path, sellBella)]);

    expect(await examplesInMicrocks()).toEqual(before.filter((e) => e !== 'PUT /api/pets/{id} sell_bella openapi-including-examples.json'));
    const sell = await fetch(`${microcks.getHttpEndpoint()}/rest/Pet%20Shop%20API/v1/api/pets/5`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bella', category: 'DOG', status: 'SOLD', price: 420.0 }),
    });
    expect(sell.status).not.toBe(200);
    expect((await mock('/api/pets/7')).status).toBe(200);
  });

  it('loads the example back', async () => {
    const sellBella = openapi.examples.find((e) => e.example === 'sell_bella')!;
    await apply('load', [exampleLeaf(openapi.file.path, sellBella)]);
    expect(await examplesInMicrocks()).toContain('PUT /api/pets/{id} sell_bella openapi-including-examples.json');
  });

  it('previews an example as Microcks serves it, matching what its source file declares', async () => {
    const [service] = (await client.liveState()).services;
    const served = await client.exchange(service.id, 'PUT /api/pets/{id}', 'sell_bella', 'openapi-including-examples.json');
    expect(served).toMatchObject({
      request: { method: 'PUT', path: '/api/pets/5', mediaType: 'application/json' },
      response: { status: '200', mediaType: 'application/json', dispatchCriteria: '/id=5' },
    });
    const declared = previewFromArtifact(openapi, { operation: 'PUT /api/pets/{id}', example: 'sell_bella' })!;
    expect(served?.request?.body).toBe(declared.request?.body);
    expect(served?.response?.body).toBe(declared.response?.body);
    expect(await client.exchange(service.id, 'PUT /api/pets/{id}', 'sell_bella', 'elsewhere.yaml')).toBeUndefined();
  });

  it('journals command lines that do the same when pasted into a shell', async () => {
    const upload = journal.findLast((r) => r.summary === 'Import openapi-including-examples.json as main artifact')!;
    const list = journal.findLast((r) => r.summary === 'List services')!;

    // The last import put sell_bella back; replaying the filtered import before it takes it out again.
    const withoutSellBella = journal.filter((r) => r.summary === upload.summary).at(-2)!;
    expect(execFileSync('bash', ['-c', withoutSellBella.command], { encoding: 'utf8' })).toBe('Pet Shop API:v1');
    expect(await examplesInMicrocks()).not.toContain('PUT /api/pets/{id} sell_bella openapi-including-examples.json');

    expect(execFileSync('bash', ['-c', upload.command], { encoding: 'utf8' })).toBe('Pet Shop API:v1');
    expect(await examplesInMicrocks()).toContain('PUT /api/pets/{id} sell_bella openapi-including-examples.json');

    const services = JSON.parse(execFileSync('bash', ['-c', list.command], { encoding: 'utf8' })) as { name: string }[];
    expect(services.map((s) => s.name)).toEqual(['Pet Shop API']);
  });

  it('shows what Microcks holds next to the sources, including examples the sources lack', async () => {
    const extra = fixture('petshop-examples.yaml').content.replace(/luna/g, 'nala').replace(/milo/g, 'otis');
    await client.upload('extra-examples.yaml', extra, false);

    const view = buildView(catalog, await client.liveState(), applied);
    const petshopView = view.services.find((s) => s.id === 'Pet Shop API:v1')!;
    const states = petshopView.operations.flatMap((op) => op.examples.map((e) => `${e.example} ${e.artifactName} ${e.state}`));
    expect(states).toEqual(expect.arrayContaining(['sell_bella openapi-including-examples.json loaded', 'nala extra-examples.yaml live-only']));
    expect(petshopView.counts).toMatchObject({ ready: 0, 'live-only': 3 });
    expect(petshopView.files.find((f) => f.artifactName === 'extra-examples.yaml')?.state).toBe('live-only');
  });

  it('deletes the service when the whole contract is unloaded', async () => {
    await apply('unload', leavesOfContract(petshop));
    expect((await client.liveState()).services.map(liveServiceId)).toEqual([]);
  });
});
