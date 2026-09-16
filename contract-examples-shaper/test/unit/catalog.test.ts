import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import { ALL_FIXTURES, fixture } from './support';

describe('buildCatalog', () => {
  const catalog = buildCatalog(ALL_FIXTURES.map(fixture));

  it('groups files by the service they name', () => {
    expect(catalog.contracts.map((c) => c.id)).toEqual([
      'Account Service:1.0.0',
      'Movie Graph API:1.0',
      'Pet Shop API:v1',
      'User signed-up API:0.1.1',
    ]);
    expect(catalog.unrecognized.map((f) => f.name)).toEqual(['README.md']);
  });

  it('orders a contract files for import: contract, companions, then metadata', () => {
    const petshop = catalog.contracts.find((c) => c.id === 'Pet Shop API:v1')!;
    expect(petshop.primary?.file.name).toBe('openapi-examples.json');
    expect(petshop.files.map((f) => [f.file.name, f.role])).toEqual([
      ['openapi-examples.json', 'primary'],
      ['petshop-behavior-collection.json', 'secondary'],
      ['petshop-examples.yaml', 'secondary'],
      ['petshop-metadata.yaml', 'secondary'],
    ]);
    expect(petshop.warnings).toEqual([]);
  });

  it('merges examples of every file under their operation', () => {
    const petshop = catalog.contracts.find((c) => c.id === 'Pet Shop API:v1')!;
    const byId = petshop.operations.find((o) => o.name === 'GET /api/pets/{id}')!;
    expect(byId.examples.map((e) => `${e.example}@${e.path}`)).toEqual([
      'rex@fixtures/openapi-examples.json',
      'unknown_pet@fixtures/openapi-examples.json',
      'luna@fixtures/petshop-examples.yaml',
      'milo@fixtures/petshop-examples.yaml',
    ]);
  });

  it('warns about companions without a contract, and about clashing artifact names', () => {
    const examples = fixture('petshop-examples.yaml');
    const lonely = buildCatalog([examples, { ...examples, path: 'other/petshop-examples.yaml' }]).contracts[0];
    expect(lonely.primary).toBeUndefined();
    expect(lonely.warnings).toEqual([
      expect.stringMatching(/No contract/),
      expect.stringMatching(/share the name petshop-examples\.yaml/),
    ]);
  });

  it('sets aside files that name no service, rather than let Microcks create one named ":"', () => {
    const content = '{\n  "openapi": "3.0.0",\n  "paths": {}\n}';
    const { contracts, unidentified, invalid } = buildCatalog([{ path: 'a.json', name: 'a.json', content, origin: 'folder' }]);
    expect([contracts, unidentified]).toEqual([[], []]);
    expect(invalid.map((a) => a.warnings)).toEqual([[expect.stringMatching(/No service name/)]]);
  });

  it('takes a lone Postman collection as the contract', () => {
    const { contracts } = buildCatalog([fixture('petshop-behavior-collection.json')]);
    expect(contracts[0].primary?.kind).toBe('postman');
  });
});
