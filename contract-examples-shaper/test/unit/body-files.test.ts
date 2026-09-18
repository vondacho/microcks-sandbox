import { describe, expect, it } from 'vitest';
import { matchOperation, readBodyFile, toApiExamples, versionMatches } from '../../src/lib/artifacts/body-files';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import { parseArtifact } from '../../src/lib/artifacts/parse';
import type { SourceFile } from '../../src/lib/artifacts/types';
import { previewFromArtifact } from '../../src/lib/preview';
import { pickedFolder } from './support';

const file = (path: string, content = '[]', origin: SourceFile['origin'] = 'folder'): SourceFile => ({
  path,
  name: path.split('/').pop()!,
  content,
  origin,
});

describe('readBodyFile', () => {
  it('reads what the path says the file answers', () => {
    expect(readBodyFile(file('v1/pets/GET_200_all-pets.json'))).toMatchObject({
      version: 'v1',
      uri: '/pets',
      status: '200',
      example: 'all-pets',
    });
    expect(readBodyFile(file('artefacts/v2.1/pets/999/GET_404_unknown-pet.json'))).toMatchObject({
      version: 'v2.1',
      uri: '/pets/999',
      status: '404',
      example: 'unknown-pet',
    });
  });

  it('takes the example name as whatever follows the status code', () => {
    expect(readBodyFile(file('v1/pets/GET_200_all_pets.json'))?.example).toBe('all_pets');
    expect(readBodyFile(file('v1/pets/GET_503_out.of.service.json'))?.example).toBe('out.of.service');
  });

  it('reads nothing from a path that does not say what it answers', () => {
    const paths = [
      'v1/pets/PUT_200_sell-bella.json', // only GET says what the request is
      'v1/GET_200_all-pets.json', // no URI under the version
      'pets/GET_200_all-pets.json', // no version folder
      'v1/pets/GET_20_all-pets.json', // not a status code
      'v1/pets/GET_200_all-pets.yaml', // not JSON
      'v1/pets/all-pets.json',
      'GET_200_all-pets.json', // picked on its own: no folders at all
    ];
    expect(paths.map((path) => readBodyFile(file(path))).filter(Boolean)).toEqual([]);
    // A URL brings its own path, never a picked folder's.
    expect(readBodyFile(file('https://example.com/v1/pets/GET_200_all-pets.json', '[]', 'url'))).toMatchObject({ uri: '/pets' });
  });

  it('knows which service a version folder names', () => {
    expect(versionMatches({ name: 'Pet Shop API', version: 'v1' }, 'v1')).toBe(true);
    expect(versionMatches({ name: 'Pet Shop API', version: '1' }, 'v1')).toBe(true);
    expect(versionMatches({ name: 'Pet Shop API', version: 'v2' }, 'v1')).toBe(false);
  });
});

describe('matchOperation', () => {
  const declared = ['GET /pets', 'POST /pets', 'GET /pets/{id}', 'PUT /pets/{id}'];

  it('reads the operation and its path parameters from the URI as called', () => {
    expect(matchOperation(declared, '/pets')).toEqual({ operation: 'GET /pets', parameters: {} });
    expect(matchOperation(declared, '/pets/999')).toEqual({ operation: 'GET /pets/{id}', parameters: { id: '999' } });
    expect(matchOperation(declared, '/orders')).toBeUndefined();
    expect(matchOperation(declared, '/pets/999/photos')).toBeUndefined();
  });
});

describe('toApiExamples', () => {
  const service = { name: 'Pet Shop API', version: 'v1' };
  const declared = ['GET /pets', 'GET /pets/{id}'];
  const bodies = ['v1/pets/GET_200_all-pets.json', 'v1/pets/999/GET_404_unknown-pet.json'].map((path) => {
    const body = readBodyFile(file(path, '{"some":"body"}'))!;
    return { ...body, ...matchOperation(declared, body.uri)! };
  });
  const source = toApiExamples(service, bodies);

  it('writes an APIExamples document Microcks reads, named after the service', () => {
    expect(source).toMatchObject({ name: 'pet-shop-api-v1-body-files.yaml', origin: 'generated' });
    const artifact = parseArtifact(source)!;
    expect(artifact).toMatchObject({ kind: 'apiexamples', role: 'secondary', granular: true });
    expect(artifact.service).toEqual(service);
    expect(artifact.examples).toEqual([
      { operation: 'GET /pets', example: 'all-pets' },
      { operation: 'GET /pets/{id}', example: 'unknown-pet' },
    ]);
  });

  it('carries the file content as the response body, under its status', () => {
    expect(previewFromArtifact(parseArtifact(source)!, { operation: 'GET /pets/{id}', example: 'unknown-pet' })).toMatchObject({
      request: { method: 'GET', path: '/pets/999', headers: [{ name: 'Accept', value: 'application/json' }] },
      response: { status: '404', mediaType: 'application/json', body: '{\n  "some": "body"\n}' },
    });
  });
});

describe('a picked folder of body files', () => {
  const catalog = buildCatalog(pickedFolder('bodies'));
  const contract = catalog.contracts[0];
  const generated = contract.files.find((f) => f.file.origin === 'generated')!;

  it('joins the contract as a companion whose examples are ready to load', () => {
    expect(contract.files.map((f) => `${f.file.path} ${f.kind}/${f.role}`)).toEqual([
      'bodies/petshop.openapi.json openapi/primary',
      'generated/pet-shop-api-v1-body-files.yaml apiexamples/secondary',
    ]);
    expect(generated.examples).toEqual([
      { operation: 'GET /pets/{id}', example: 'unknown-pet' },
      { operation: 'GET /pets', example: 'all-pets' },
      { operation: 'GET /pets', example: 'available-pets' },
      { operation: 'GET /pets', example: 'sold-pets' },
    ]);
  });

  it('says what it built, what it left out, and what answers the same call', () => {
    expect(generated.warnings).toEqual([
      'Built from 4 files whose path says what they answer.',
      'bodies/v1/orders/GET_200_all-orders.json: no GET of the contract answers /orders, so it is left out.',
      'all-pets, available-pets, sold-pets all answer GET /pets: Microcks serves one of them.',
    ]);
  });

  it('leaves every other unreadable file where it was', () => {
    expect(catalog.unrecognized.map((f) => f.name).sort()).toEqual(['PUT_200_sell-bella.json', 'notes.txt']);
  });

  it('keeps body files whose version names no contract out of it', () => {
    const other = buildCatalog(pickedFolder('bodies').map((f) => ({ ...f, path: f.path.replace('/v1/', '/v9/') })));
    expect(other.contracts[0].files.map((f) => f.kind)).toEqual(['openapi']);
    expect(other.unrecognized.filter((f) => f.name.startsWith('GET_'))).toHaveLength(5);
  });
});
