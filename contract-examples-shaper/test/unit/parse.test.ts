import { describe, expect, it } from 'vitest';
import { detectKind } from '../../src/lib/artifacts/detect';
import { parseArtifact } from '../../src/lib/artifacts/parse';
import { fixture } from './support';

describe('detectKind mirrors Microcks type detection', () => {
  it.each([
    ['openapi-including-examples.json', 'openapi'],
    ['petshop-behavior-collection.json', 'postman'],
    ['petshop-examples.yaml', 'apiexamples'],
    ['petshop-metadata.yaml', 'apimetadata'],
    ['user-signedup-asyncapi.yaml', 'asyncapi2'],
    ['account-asyncapi3.yaml', 'asyncapi3'],
    ['films.graphql', 'graphql'],
    ['README.md', undefined],
  ])('%s is %s', (name, kind) => {
    expect(detectKind(fixture(name).content)).toBe(kind);
  });

  it('decides on the first line carrying a pragma, as Microcks reads line by line', () => {
    expect(detectKind('{\n  "swagger": "2.0",\n  "x": "openapi: 3"\n}')).toBe('swagger');
    expect(detectKind('syntax = "proto3";\npackage foo;')).toBe('grpc');
    expect(detectKind('<?xml version="1.0"?>\n<con:soapui-project/>')).toBe('soapui');
  });
});

describe('parseArtifact', () => {
  it('names OpenAPI examples by operation, from response examples only', () => {
    const a = parseArtifact(fixture('openapi-including-examples.json'))!;
    expect(a).toMatchObject({ kind: 'openapi', role: 'primary', format: 'json', granular: true });
    expect(a.service).toEqual({ name: 'Pet Shop API', version: 'v1' });
    // As Microcks 1.14 reports them for this very file: DELETE's 204 has no content, hence no 'delete_bella'.
    expect(a.examples).toEqual(
      expect.arrayContaining([
        { operation: 'GET /api/pets', example: 'all_pets' },
        { operation: 'PUT /api/pets/{id}', example: 'sell_bella' },
        { operation: 'DELETE /api/pets/{id}', example: 'unknown_pet' },
      ]),
    );
    expect(a.examples).toHaveLength(10);
  });

  it('reads the Postman version from the description and names operations after their items', () => {
    const a = parseArtifact(fixture('petshop-behavior-collection.json'))!;
    expect(a.service).toEqual({ name: 'Pet Shop API', version: 'v1' });
    expect(a.examples).toEqual([]);
  });

  it('lists APIExamples examples and identifies metadata', () => {
    expect(parseArtifact(fixture('petshop-examples.yaml'))!).toMatchObject({
      role: 'secondary',
      format: 'yaml',
      granular: true,
      examples: [
        { operation: 'GET /api/pets/{id}', example: 'luna' },
        { operation: 'GET /api/pets/{id}', example: 'milo' },
        { operation: 'PUT /api/pets/{id}', example: 'reserve_luna' },
      ],
    });
    expect(parseArtifact(fixture('petshop-metadata.yaml'))!).toMatchObject({
      kind: 'apimetadata',
      role: 'secondary',
      service: { name: 'Pet Shop API', version: 'v1' },
      examples: [],
    });
  });

  it('follows message references in AsyncAPI 2 and 3', () => {
    expect(parseArtifact(fixture('user-signedup-asyncapi.yaml'))!.examples).toEqual([
      { operation: 'SUBSCRIBE user/signedup', example: 'laurent' },
      { operation: 'SUBSCRIBE user/signedup', example: 'john' },
      { operation: 'PUBLISH user/welcomed', example: 'laurent' },
      { operation: 'PUBLISH user/welcomed', example: 'john' },
    ]);
    expect(parseArtifact(fixture('account-asyncapi3.yaml'))!.examples).toEqual([
      { operation: 'SEND sendUserSignedUp', example: 'alice' },
      { operation: 'SEND sendUserSignedUp', example: 'bob' },
    ]);
  });

  it('keeps AsyncAPI 3 unnamed examples whole, since Microcks numbers them', () => {
    const content = fixture('account-asyncapi3.yaml').content.replace('- name: alice\n          payload', '- payload');
    const a = parseArtifact({ ...fixture('account-asyncapi3.yaml'), content })!;
    expect(a.granular).toBe(false);
    expect(a.warnings.join()).toMatch(/no name/);
  });

  it('identifies GraphQL through its microcksId comment, as a whole file', () => {
    expect(parseArtifact(fixture('films.graphql'))!).toMatchObject({
      kind: 'graphql',
      format: 'text',
      granular: false,
      service: { name: 'Movie Graph API', version: '1.0' },
    });
  });

  it('warns about references to other files', () => {
    const content = JSON.stringify({ openapi: '3.0.0', info: { title: 'A', version: '1' }, paths: { '/a': { $ref: 'paths/a.yaml' } } }, null, 2);
    expect(parseArtifact({ path: 'a.json', name: 'a.json', content, origin: 'folder' })!.warnings.join()).toMatch(/paths\/a\.yaml/);
  });
});
