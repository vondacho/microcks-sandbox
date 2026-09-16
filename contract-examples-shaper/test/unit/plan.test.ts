import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import { parseArtifact } from '../../src/lib/artifacts/parse';
import type { LiveService, LiveState } from '../../src/lib/microcks/live-state';
import {
  buildPlan,
  exampleLeaf,
  fileLeaf,
  leavesOfContract,
  leavesOfFile,
  appliedKey,
  serviceLeaf,
  type Mode,
  type Step,
} from '../../src/lib/plan';
import { fixture } from './support';

const catalog = buildCatalog(
  ['openapi-examples.json', 'petshop-examples.yaml', 'petshop-metadata.yaml', 'films.graphql'].map(fixture),
);
const petshop = catalog.contracts.find((c) => c.id === 'Pet Shop API:v1')!;
const [openapi, examples, metadata] = petshop.files;
const films = catalog.contracts.find((c) => c.id === 'Movie Graph API:1.0')!;

/** A Microcks holding the given files of the Pet Shop, with all their examples. */
function liveWith(...files: typeof petshop.files): LiveState {
  const service: LiveService = {
    id: 'svc-1',
    name: 'Pet Shop API',
    version: 'v1',
    type: 'REST',
    sourceArtifact: 'openapi-examples.json',
    messages: files.flatMap((f) => f.examples.map((ref) => ({ ...ref, sourceArtifact: f.file.name }))),
  };
  return { services: files.length ? [service] : [] };
}

const EMPTY: LiveState = { services: [] };

function plan(mode: Mode, live: LiveState, selected: string[], applied: string[] = []) {
  return buildPlan({ catalog, live, mode, selected: new Set(selected), appliedFiles: new Set(applied) });
}

/** A readable digest of the steps: `upload openapi-examples.json main 3/10`, `delete svc-1`. */
const digest = (steps: Step[]) =>
  steps.map((s) =>
    s.type === 'upload'
      ? `upload ${s.artifactName}${s.mainArtifact ? ' main' : ''} ${s.examples}/${s.total}`
      : s.type === 'delete'
        ? `delete ${s.serviceId}`
        : `blocked`,
  );

const leaf = (file: typeof openapi, example: string) =>
  exampleLeaf(file.file.path, file.examples.find((e) => e.example === example)!);

const examplesOf = (content: string) => parseArtifact({ ...openapi.file, content })!.examples.map((e) => e.example);

describe('loading', () => {
  it('creates the service from its contract before attaching companions, and applies metadata last', () => {
    const { steps, appliedFiles } = plan('load', EMPTY, leavesOfContract(petshop));
    expect(digest(steps)).toEqual([
      'upload openapi-examples.json main 10/10',
      'upload petshop-examples.yaml 3/3',
      'upload petshop-metadata.yaml 0/0',
    ]);
    expect(appliedFiles).toEqual({ 'Pet Shop API:v1': ['petshop-metadata.yaml'] });
  });

  it('creates the service with no contract examples when only companion examples are picked', () => {
    const { steps } = plan('load', EMPTY, [leaf(examples, 'luna')]);
    expect(digest(steps)).toEqual(['upload openapi-examples.json main 0/10', 'upload petshop-examples.yaml 1/3']);
    expect(examplesOf((steps[0] as Extract<Step, { type: 'upload' }>).content)).toEqual([]);
  });

  it('adds picked examples to those already loaded from the same file', () => {
    const live = liveWith(openapi);
    live.services[0].messages = live.services[0].messages.filter((m) => m.example !== 'sell_bella');
    const { steps } = plan('load', live, [leaf(openapi, 'sell_bella')]);
    expect(digest(steps)).toEqual(['upload openapi-examples.json main 10/10']);
  });

  it('does nothing for examples already loaded', () => {
    expect(plan('load', liveWith(openapi), [leaf(openapi, 'rex')]).steps).toEqual([]);
  });

  it('re-applies loaded metadata after re-importing the contract', () => {
    const live = liveWith(openapi);
    live.services[0].messages = live.services[0].messages.filter((m) => m.example !== 'rex');
    const { steps } = plan('load', live, [leaf(openapi, 'rex')], [appliedKey(petshop.id, 'petshop-metadata.yaml')]);
    expect(digest(steps)).toEqual(['upload openapi-examples.json main 10/10', 'upload petshop-metadata.yaml 0/0']);
  });

  it('cannot create a service without its contract', () => {
    const lonely = buildCatalog([fixture('petshop-examples.yaml')]);
    const { steps } = buildPlan({
      catalog: lonely,
      live: EMPTY,
      mode: 'load',
      selected: new Set(leavesOfContract(lonely.contracts[0])),
      appliedFiles: new Set(),
    });
    expect(digest(steps)).toEqual(['blocked']);
  });

  it('loads a companion without examples as a whole, e.g. a collection holding only test scripts', () => {
    const withCollection = buildCatalog(['openapi-examples.json', 'petshop-behavior-collection.json'].map(fixture));
    const { steps } = buildPlan({
      catalog: withCollection,
      live: EMPTY,
      mode: 'load',
      selected: new Set(leavesOfContract(withCollection.contracts[0])),
      appliedFiles: new Set(),
    });
    expect(digest(steps)).toEqual(['upload openapi-examples.json main 10/10', 'upload petshop-behavior-collection.json 0/0']);
  });

  it('remembers a companion that leaves no trace in Microcks once loaded', () => {
    const withCollection = buildCatalog(['openapi-examples.json', 'petshop-behavior-collection.json'].map(fixture));
    const { appliedFiles } = buildPlan({
      catalog: withCollection,
      live: EMPTY,
      mode: 'load',
      selected: new Set(leavesOfContract(withCollection.contracts[0])),
      appliedFiles: new Set(),
    });
    expect(appliedFiles).toEqual({ 'Pet Shop API:v1': ['petshop-behavior-collection.json'] });
  });

  it('loads whole-file kinds as they are', () => {
    expect(digest(plan('load', EMPTY, leavesOfContract(films)).steps)).toEqual(['upload films.graphql main 0/0']);
  });
});

describe('unloading', () => {
  it('removes one example by re-uploading its file without it', () => {
    const { steps } = plan('unload', liveWith(openapi, examples), [leaf(openapi, 'sell_bella')]);
    expect(digest(steps)).toEqual(['upload openapi-examples.json main 9/10']);
    expect(examplesOf((steps[0] as Extract<Step, { type: 'upload' }>).content)).not.toContain('sell_bella');
  });

  it('empties a companion file without touching the contract', () => {
    const { steps } = plan('unload', liveWith(openapi, examples), leavesOfFile(examples));
    expect(digest(steps)).toEqual(['upload petshop-examples.yaml 0/3']);
  });

  it('deletes the service when the whole contract is picked', () => {
    const { steps, appliedFiles } = plan('unload', liveWith(openapi, examples), leavesOfContract(petshop), [
      appliedKey(petshop.id, 'petshop-metadata.yaml'),
    ]);
    expect(digest(steps)).toEqual(['delete svc-1']);
    expect(appliedFiles).toEqual({ 'Pet Shop API:v1': [] });
  });

  it('takes metadata back by re-importing the contract as it is loaded', () => {
    const live = liveWith(openapi, examples);
    live.services[0].messages = live.services[0].messages.filter((m) => m.example !== 'rex');
    const { steps, appliedFiles } = plan('unload', live, [fileLeaf(metadata.file.path)], [
      appliedKey(petshop.id, 'petshop-metadata.yaml'),
    ]);
    expect(digest(steps)).toEqual(['upload openapi-examples.json main 9/10']);
    expect(appliedFiles).toEqual({ 'Pet Shop API:v1': [] });
  });

  it('deletes the service when everything Microcks holds of a contract is picked, ready items or not', () => {
    const loadedLeaves = leavesOfFile(openapi);
    expect(digest(plan('unload', liveWith(openapi), loadedLeaves).steps)).toEqual(['delete svc-1']);
  });

  it('keeps a service created from another file, and empties the files picked instead', () => {
    const live = liveWith(openapi, examples);
    live.services[0].sourceArtifact = 'petshop-openapi-v0.json';
    expect(digest(plan('unload', live, [...leavesOfFile(openapi), ...leavesOfFile(examples)]).steps)).toEqual([
      'upload openapi-examples.json main 0/10',
      'upload petshop-examples.yaml 0/3',
    ]);
  });

  it('leaves alone picked items that are still ready to load', () => {
    const { steps } = plan('unload', liveWith(openapi, examples), [leaf(openapi, 'rex'), fileLeaf(films.files[0].file.path), fileLeaf(metadata.file.path)]);
    expect(digest(steps)).toEqual(['upload openapi-examples.json main 9/10']);
  });

  it('says in the plan when deleting takes examples the sources do not hold', () => {
    const live = liveWith(openapi);
    live.services[0].messages.push({ operation: 'GET /api/pets', example: 'old', sourceArtifact: 'legacy.yaml' });
    const [step] = plan('unload', live, leavesOfContract(petshop)).steps;
    expect(step.reason).toMatch(/including 1 example\(s\) that are not in the sources/);
  });

  it('does nothing for a contract Microcks does not hold', () => {
    expect(plan('unload', EMPTY, leavesOfContract(petshop)).steps).toEqual([]);
  });

  it('deletes a service found only in Microcks', () => {
    const live: LiveState = { services: [{ id: 'svc-9', name: 'Other', version: '2', type: 'REST', messages: [] }] };
    expect(digest(plan('unload', live, [serviceLeaf('Other:2')]).steps)).toEqual(['delete svc-9']);
  });
});
