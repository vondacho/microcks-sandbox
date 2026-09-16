import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import type { LiveService, LiveState } from '../../src/lib/microcks/live-state';
import { appliedKey, serviceLeaf } from '../../src/lib/plan';
import { buildView, filterService, leavesOf, type ServiceItem } from '../../src/lib/view';
import { fixture } from './support';

const catalog = buildCatalog(
  ['openapi-including-examples.json', 'petshop-examples.yaml', 'petshop-metadata.yaml', 'films.graphql'].map(fixture),
);
const petshop = catalog.contracts.find((c) => c.id === 'Pet Shop API:v1')!;
const openapi = petshop.primary!;

/** Microcks holding the Pet Shop contract without sell_bella, an example from a file the sources lack, and a
 * service the sources know nothing about. */
const live: LiveState = {
  services: [
    {
      id: 'svc-1',
      name: 'Pet Shop API',
      version: 'v1',
      type: 'REST',
      sourceArtifact: 'openapi-including-examples.json',
      messages: [
        ...openapi.examples.filter((e) => e.example !== 'sell_bella').map((e) => ({ ...e, sourceArtifact: 'openapi-including-examples.json' })),
        { operation: 'GET /api/pets/{id}', example: 'old_rex', sourceArtifact: 'legacy-examples.yaml' },
      ],
    },
    {
      id: 'svc-2',
      name: 'Legacy API',
      version: '0.9',
      type: 'REST',
      sourceArtifact: 'legacy.json',
      messages: [{ operation: 'GET /ping', example: 'pong', sourceArtifact: 'legacy.json' }],
    },
  ] satisfies LiveService[],
};

const view = buildView(catalog, live, new Set());
const service = (id: string) => view.services.find((s) => s.id === id)!;

/** `operation example (artifact): state` for every example shown. */
const examples = (s: ServiceItem | undefined) =>
  (s?.operations ?? []).flatMap((op) => op.examples.map((e) => `${op.name} ${e.example} (${e.artifactName}): ${e.state}`));

describe('buildView', () => {
  it('shows every service once, from the sources, Microcks, or both', () => {
    expect(view.services.map((s) => [s.id, Boolean(s.contract), Boolean(s.live)])).toEqual([
      ['Legacy API:0.9', false, true],
      ['Movie Graph API:1.0', true, false],
      ['Pet Shop API:v1', true, true],
    ]);
  });

  it('marks each example loaded, ready to load, or only in Microcks', () => {
    const shown = examples(service('Pet Shop API:v1'));
    expect(shown).toEqual(
      expect.arrayContaining([
        'GET /api/pets/{id} rex (openapi-including-examples.json): loaded',
        'PUT /api/pets/{id} sell_bella (openapi-including-examples.json): ready',
        'GET /api/pets/{id} luna (petshop-examples.yaml): ready',
        'GET /api/pets/{id} old_rex (legacy-examples.yaml): live-only',
      ]),
    );
    expect(service('Pet Shop API:v1').counts).toEqual({ loaded: 9, ready: 5, 'live-only': 1 });
  });

  it('lists files with their state, including artifacts Microcks imported that the sources lack', () => {
    expect(service('Pet Shop API:v1').files.map((f) => [f.artifactName, f.state, f.examples ?? null, f.main])).toEqual([
      ['openapi-including-examples.json', 'loaded', { loaded: 9, total: 10 }, true],
      ['petshop-examples.yaml', 'ready', { loaded: 0, total: 3 }, false],
      ['petshop-metadata.yaml', 'ready', null, false],
      ['legacy-examples.yaml', 'live-only', null, false],
    ]);
  });

  it('takes metadata as loaded once applied', () => {
    const applied = new Set([appliedKey('Pet Shop API:v1', 'petshop-metadata.yaml')]);
    const metadata = buildView(catalog, live, applied).services.find((s) => s.id === 'Pet Shop API:v1')!.files[2];
    expect(metadata.state).toBe('loaded');
  });

  it('lets a service only in Microcks be picked as a whole, but not its examples', () => {
    const legacy = service('Legacy API:0.9');
    expect(examples(legacy)).toEqual(['GET /ping pong (legacy.json): live-only']);
    expect(leavesOf(legacy)).toEqual([serviceLeaf('Legacy API:0.9')]);
  });

  it('counts per tab, what Microcks holds counting as loaded', () => {
    // Pet Shop: 9 loaded + 5 ready + 1 live-only; Movie Graph: 1 ready; Legacy: 1 live-only.
    expect(view.counts).toEqual({ all: 17, ready: 6, loaded: 11 });
  });
});

describe('filterService', () => {
  it('keeps what is ready to load in the ready tab, and a checkbox over it selects only that', () => {
    const ready = filterService(service('Pet Shop API:v1'), 'ready')!;
    expect(examples(ready)).toEqual([
      'GET /api/pets/{id} luna (petshop-examples.yaml): ready',
      'GET /api/pets/{id} milo (petshop-examples.yaml): ready',
      'PUT /api/pets/{id} sell_bella (openapi-including-examples.json): ready',
      'PUT /api/pets/{id} reserve_luna (petshop-examples.yaml): ready',
    ]);
    expect(ready.files.map((f) => f.artifactName)).toEqual(['openapi-including-examples.json', 'petshop-examples.yaml', 'petshop-metadata.yaml']);
    expect(leavesOf(ready)).toHaveLength(5);
  });

  it('keeps what Microcks holds in the loaded tab', () => {
    const loaded = filterService(service('Pet Shop API:v1'), 'loaded')!;
    expect(examples(loaded).every((e) => !e.endsWith(': ready'))).toBe(true);
    expect(loaded.files.map((f) => f.artifactName)).toEqual(['openapi-including-examples.json', 'legacy-examples.yaml']);
    expect(filterService(service('Movie Graph API:1.0'), 'loaded')).toBeUndefined();
    expect(filterService(service('Legacy API:0.9'), 'ready')).toBeUndefined();
  });
});
