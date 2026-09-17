import 'fake-indexeddb/auto';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import { parseArtifact } from '../../src/lib/artifacts/parse';
import {
  concreteStatus,
  draftIssues,
  duplicateDraft,
  freshName,
  hasErrors,
  newDraft,
  type Draft,
  type IssueContext,
} from '../../src/lib/design/draft';
import { exportPackage } from '../../src/lib/design/export';
import { designContract, isDesignable, type DesignContract } from '../../src/lib/design/operations';
import { defaultFileName, packageDrafts } from '../../src/lib/design/package';
import { coerceParameter, sampleFromSchema, SchemaValidator, toDraft07 } from '../../src/lib/design/schema';
import { IndexedDbDraftStore, MemoryDraftStore } from '../../src/lib/design/store';
import { fixture } from './support';

const design = designContract(buildCatalog([fixture('openapi.json')]).contracts[0]) as DesignContract;
const op = (name: string) => design.operations.find((o) => o.name === name)!;
const validator = new SchemaValidator(design.document, design.openapi);
const ctx = (siblings: Draft[] = [], existing: string[] = []): IssueContext => ({ design, validator, siblings, existing });

describe('designContract', () => {
  it('lists the operations of an OpenAPI contract with what they declare', () => {
    expect(isDesignable(design)).toBe(true);
    expect(design.openapi).toBe('3.1');
    expect(design.operations.map((o) => o.name)).toEqual([
      'GET /api/pets/{id}',
      'PUT /api/pets/{id}',
      'DELETE /api/pets/{id}',
      'GET /api/pets',
      'POST /api/pets',
    ]);
    const put = op('PUT /api/pets/{id}');
    expect(put.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'integer', format: 'int64' }, description: undefined }]);
    expect(put.requestBody).toMatchObject({ required: true, contents: [{ mediaType: 'application/json' }] });
    expect(put.responses.map((r) => r.status)).toEqual(expect.arrayContaining(['200']));
  });

  it('explains why a contract cannot be designed for', () => {
    const graph = designContract(buildCatalog([fixture('films.graphql')]).contracts[0]);
    expect(isDesignable(graph)).toBe(false);
    expect('reason' in graph && graph.reason).toMatch(/OpenAPI 3/);
  });
});

describe('schemas', () => {
  it('samples values the schema accepts', () => {
    for (const operation of design.operations) {
      for (const content of [...(operation.requestBody?.contents ?? []), ...operation.responses.flatMap((r) => r.contents)]) {
        expect(validator.validate(content.schema, sampleFromSchema(design.document, content.schema))).toEqual([]);
      }
    }
    expect(sampleFromSchema(design.document, { $ref: '#/components/schemas/PetRequest' })).toEqual({
      name: 'string',
      category: 'string',
      status: 'AVAILABLE',
      price: 0,
    });
  });

  it('reports what a value breaks, with where', () => {
    const issues = validator.validate({ $ref: '#/components/schemas/PetRequest' }, { name: 'Rex', category: 'DOG', status: 'LOST', price: -1 });
    expect(issues.map((i) => `${i.path} ${i.message}`)).toEqual([
      '/status must be equal to one of the allowed values: "AVAILABLE", "PENDING", "SOLD"',
      '/price must be >= 0',
    ]);
  });

  it('understands OpenAPI 3.0 nullable and boolean exclusive bounds', () => {
    expect(toDraft07({ type: 'string', nullable: true })).toEqual({ type: ['string', 'null'] });
    expect(toDraft07({ type: 'number', minimum: 0, exclusiveMinimum: true })).toEqual({ type: 'number', exclusiveMinimum: 0 });
    const v30 = new SchemaValidator({ components: { schemas: { N: { type: 'integer', nullable: true } } } }, '3.0');
    expect(v30.validate({ $ref: '#/components/schemas/N' }, null)).toEqual([]);
  });

  it('types parameter text by its schema', () => {
    expect(coerceParameter(design.document, { type: 'integer' }, '5')).toBe(5);
    expect(coerceParameter(design.document, { type: 'integer' }, 'five')).toBe('five');
    expect(coerceParameter(design.document, { type: 'array', items: { type: 'integer' } }, '1, 2')).toEqual([1, 2]);
  });
});

describe('drafts', () => {
  it('start from the contract: required parameters, sampled bodies, the success response', () => {
    const draft = newDraft(design, op('PUT /api/pets/{id}'), 'sell_bella');
    expect(draft).toMatchObject({
      contractId: 'Pet Shop API:v1',
      operation: 'PUT /api/pets/{id}',
      request: { parameters: { id: '0' }, mediaType: 'application/json' },
      response: { status: '200', mediaType: 'application/json' },
    });
    expect(JSON.parse(draft.request.body!)).toMatchObject({ status: 'AVAILABLE' });
    expect(draftIssues(draft, op('PUT /api/pets/{id}'), ctx())).toEqual([]);
  });

  it('block packaging only for what makes an example unusable', () => {
    const put = op('PUT /api/pets/{id}');
    const draft = newDraft(design, put, ' ');
    draft.request.parameters.id = '';
    draft.response.body = '{ "id": 5, ';
    const issues = draftIssues(draft, put, ctx());
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.field)).toEqual(['name', 'parameter:id', 'response.body']);
    expect(hasErrors(issues)).toBe(true);
  });

  it('only warn about what the contract rejects: an example of a 400 carries a rejected request', () => {
    const post = op('POST /api/pets');
    const draft = newDraft(design, post, 'invalid_pet');
    draft.request.body = JSON.stringify({ name: '', category: 'DOG', status: 'AVAILABLE', price: -1 });
    draft.response.status = '400';
    const issues = draftIssues(draft, post, ctx());
    expect(hasErrors(issues)).toBe(false);
    expect(issues.map((i) => `${i.field}: ${i.message}`)).toEqual(
      expect.arrayContaining(['request.body: /price must be >= 0']),
    );
  });

  it('catch names used twice, by drafts or by the sources', () => {
    const get = op('GET /api/pets/{id}');
    const a = newDraft(design, get, 'rex');
    const b = duplicateDraft(a, 'rex');
    expect(draftIssues(b, get, ctx([a, b])).find((i) => i.field === 'name')?.severity).toBe('error');
    expect(draftIssues(a, get, ctx([a], ['rex'])).find((i) => i.field === 'name')?.severity).toBe('warning');
    expect(freshName('rex', ['rex', 'rex_2'])).toBe('rex_3');
  });

  it('serve a declared status range with a concrete status', () => {
    expect(concreteStatus('2XX')).toBe('200');
    expect(concreteStatus('default')).toBe('500');
  });
});

describe('packageDrafts', () => {
  const rex = newDraft(design, op('GET /api/pets/{id}'), 'rex');
  rex.request.parameters.id = '1';
  rex.response.body = JSON.stringify({ id: 1, name: 'Rex', category: 'DOG', status: 'AVAILABLE', price: 250 });
  const sell = newDraft(design, op('PUT /api/pets/{id}'), 'sell_bella');
  sell.request.parameters.id = '5';

  it('writes an APIExamples document Microcks recognizes, holding exactly the drafts', () => {
    const file = packageDrafts(design, [sell, rex]);
    expect(file).toMatchObject({ contractId: 'Pet Shop API:v1', fileName: 'pet-shop-api-v1-examples.yaml', examples: 2 });
    const read = parseArtifact({ path: file.fileName, name: file.fileName, content: file.content, origin: 'folder' })!;
    expect(read.kind).toBe('apiexamples');
    // Contract order, not the order drafts were given in.
    expect(read.examples).toEqual([
      { operation: 'GET /api/pets/{id}', example: 'rex' },
      { operation: 'PUT /api/pets/{id}', example: 'sell_bella' },
    ]);
    expect(file.content).toContain(`    rex:
      request:
        parameters:
          id: "1"
        headers:
          Accept: application/json
      response:
        mediaType: application/json
        status: "200"
        body:
          id: 1
          name: Rex`);
  });

  it('names the file after the contract', () => {
    expect(defaultFileName(design)).toBe('pet-shop-api-v1-examples.yaml');
  });

  it('exports one file as itself, several as a zip', () => {
    const one = packageDrafts(design, [rex]);
    expect(exportPackage([one])).toMatchObject({ fileName: 'pet-shop-api-v1-examples.yaml', type: 'application/yaml' });
    const other = { ...one, contractId: 'Other:1', fileName: 'other-1-examples.yaml' };
    const zip = exportPackage([one, other], new Date('2026-09-17T08:30:00Z'));
    expect(zip.fileName).toBe('api-examples-20260917-0830.zip');
    const entries = unzipSync(zip.data);
    expect(Object.keys(entries)).toEqual(['pet-shop-api-v1-examples.yaml', 'other-1-examples.yaml']);
    expect(strFromU8(entries['pet-shop-api-v1-examples.yaml'])).toBe(one.content);
    expect(() => exportPackage([one, one])).toThrow(/rename one/);
  });
});

describe.each([
  ['memory', async () => new MemoryDraftStore()],
  ['IndexedDB', async () => IndexedDbDraftStore.open()],
])('%s draft store', (_, open) => {
  it('keeps, updates and deletes drafts', async () => {
    const store = await open();
    const draft = newDraft(design, op('GET /api/pets'), 'all_pets');
    await store.put(draft);
    await store.put({ ...draft, name: 'every_pet' });
    expect((await store.all()).map((d) => d.name)).toEqual(['every_pet']);
    await store.delete(draft.id);
    expect(await store.all()).toEqual([]);
  });
});
