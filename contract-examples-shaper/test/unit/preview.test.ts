import { describe, expect, it } from 'vitest';
import { parseArtifact } from '../../src/lib/artifacts/parse';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import { newDraft } from '../../src/lib/design/draft';
import { designContract, type DesignContract } from '../../src/lib/design/operations';
import { previewFromArtifact, previewFromDraft, previewFromMicrocks, requestLine } from '../../src/lib/preview';
import { fixture } from './support';

const openapi = parseArtifact(fixture('openapi-including-examples.json'))!;

describe('requestLine', () => {
  it('fills path parameters and puts the others in the query string', () => {
    expect(requestLine('PUT /api/pets/{id}', [{ name: 'id', value: '5' }])).toEqual({ method: 'PUT', path: '/api/pets/5' });
    expect(requestLine('GET /api/pets', [{ name: 'status', value: 'SOLD' }])).toEqual({ method: 'GET', path: '/api/pets?status=SOLD' });
    expect(requestLine('SUBSCRIBE', [])).toEqual({});
  });
});

describe('previewFromArtifact', () => {
  it('assembles an OpenAPI example from its parameter, request body and response examples', () => {
    expect(previewFromArtifact(openapi, { operation: 'PUT /api/pets/{id}', example: 'sell_bella' })).toEqual({
      operation: 'PUT /api/pets/{id}',
      example: 'sell_bella',
      summary: 'The pet being sold',
      request: {
        method: 'PUT',
        path: '/api/pets/5',
        headers: [],
        mediaType: 'application/json',
        body: JSON.stringify({ name: 'Bella', category: 'DOG', status: 'SOLD', price: 420.0 }, null, 2),
      },
      response: {
        status: '200',
        mediaType: 'application/json',
        headers: [],
        body: JSON.stringify({ id: 5, name: 'Bella', category: 'DOG', status: 'SOLD', price: 420.0 }, null, 2),
      },
    });
  });

  it('finds the response an example is declared under, with its headers and query parameters', () => {
    expect(previewFromArtifact(openapi, { operation: 'POST /api/pets', example: 'new_pet_bella' })?.response).toMatchObject({
      status: '201',
      headers: [{ name: 'Location', value: '/api/pets/5' }],
    });
    expect(previewFromArtifact(openapi, { operation: 'PUT /api/pets/{id}', example: 'unknown_pet' })?.response).toMatchObject({
      status: '404',
      mediaType: 'application/problem+json',
    });
    expect(previewFromArtifact(openapi, { operation: 'GET /api/pets', example: 'sold_pets' })?.request?.path).toBe('/api/pets?status=SOLD');
    expect(previewFromArtifact(openapi, { operation: 'GET /api/pets', example: 'nope' })).toBeUndefined();
  });

  it('reads APIExamples as written', () => {
    expect(previewFromArtifact(parseArtifact(fixture('petshop-examples.yaml'))!, { operation: 'PUT /api/pets/{id}', example: 'reserve_luna' })).toMatchObject({
      request: { method: 'PUT', path: '/api/pets/7', body: expect.stringContaining('"status": "PENDING"') },
      response: { status: '200', mediaType: 'application/json', body: expect.stringContaining('"name": "Luna"') },
    });
  });

  it('reads AsyncAPI examples as messages', () => {
    expect(previewFromArtifact(parseArtifact(fixture('user-signedup-asyncapi.yaml'))!, { operation: 'SUBSCRIBE user/signedup', example: 'john' })).toEqual({
      operation: 'SUBSCRIBE user/signedup',
      example: 'john',
      summary: undefined,
      event: { headers: [], mediaType: undefined, payload: JSON.stringify({ displayName: 'John Doe' }, null, 2) },
    });
    expect(previewFromArtifact(parseArtifact(fixture('account-asyncapi3.yaml'))!, { operation: 'SEND sendUserSignedUp', example: 'bob' })?.event?.payload).toContain('bob@example.com');
  });

  it('reads Postman saved responses with the request they were saved for', () => {
    const collection = {
      info: { _postman_id: 'x', name: 'Pet Shop API', description: 'version=v1', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: 'GET /api/pets/{id}',
          request: { method: 'GET', url: 'http://localhost:8080/api/pets/:id' },
          response: [
            {
              name: 'rex',
              originalRequest: { method: 'GET', url: { raw: 'http://localhost:8080/api/pets/1' }, header: [{ key: 'Accept', value: 'application/json' }] },
              code: 200,
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: '{"id":1,"name":"Rex"}',
            },
          ],
        },
      ],
    };
    const artifact = parseArtifact({ path: 'c.json', name: 'c.json', content: JSON.stringify(collection, null, 2), origin: 'folder' })!;
    expect(artifact.kind).toBe('postman');
    expect(previewFromArtifact(artifact, { operation: 'GET /api/pets/{id}', example: 'rex' })).toMatchObject({
      request: { method: 'GET', path: '/api/pets/1', headers: [{ name: 'Accept', value: 'application/json' }] },
      response: { status: '200', mediaType: 'application/json', body: JSON.stringify({ id: 1, name: 'Rex' }, null, 2) },
    });
  });
});

describe('previewFromDraft', () => {
  it('shows a draft as the exchange it describes', () => {
    const design = designContract(buildCatalog([fixture('openapi.json')]).contracts[0]) as DesignContract;
    const draft = newDraft(design, design.operations.find((o) => o.name === 'GET /api/pets/{id}')!, 'luna');
    draft.request.parameters.id = '7';
    draft.response.body = '{"id":7}';
    expect(previewFromDraft(draft)).toMatchObject({
      example: 'luna',
      request: { method: 'GET', path: '/api/pets/7', body: undefined },
      response: { status: '200', body: '{\n  "id": 7\n}' },
    });
  });
});

describe('previewFromMicrocks', () => {
  it('reads an exchange as Microcks stores it', () => {
    // As GET /api/services/{id}?messages=true answers for sell_bella (Microcks 1.14).
    const exchange = {
      type: 'reqRespPair',
      name: 'sell_bella',
      request: {
        name: 'sell_bella',
        content: '{"name":"Bella","category":"DOG","status":"SOLD","price":420.0}',
        sourceArtifact: 'openapi-including-examples.json',
        headers: [
          { name: 'Content-Type', values: ['application/json'] },
          { name: 'Accept', values: ['application/json'] },
        ],
        queryParameters: [{ name: 'id', value: '5' }],
      },
      response: {
        name: 'sell_bella',
        content: '{"id":5,"name":"Bella","category":"DOG","status":"SOLD","price":420.0}',
        sourceArtifact: 'openapi-including-examples.json',
        status: '200',
        mediaType: 'application/json',
        dispatchCriteria: '/id=5',
      },
    };
    expect(previewFromMicrocks('PUT /api/pets/{id}', exchange)).toMatchObject({
      example: 'sell_bella',
      request: { method: 'PUT', path: '/api/pets/5', mediaType: 'application/json', headers: [{ name: 'Content-Type' }, { name: 'Accept' }] },
      response: { status: '200', dispatchCriteria: '/id=5', body: expect.stringContaining('"status": "SOLD"') },
    });
  });

  it('reads an event message', () => {
    const preview = previewFromMicrocks('SUBSCRIBE user/signedup', {
      type: 'unidirEvent',
      eventMessage: { name: 'john', content: '{"displayName":"John Doe"}', mediaType: 'application/json', headers: [] },
    });
    expect(preview).toMatchObject({ example: 'john', event: { mediaType: 'application/json', payload: expect.stringContaining('John Doe') } });
    expect(preview.request).toBeUndefined();
  });
});
