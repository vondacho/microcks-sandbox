import { describe, expect, it } from 'vitest';
import { exampleKey, filterArtifact } from '../../src/lib/artifacts/filter';
import { parseArtifact } from '../../src/lib/artifacts/parse';
import { fixture } from './support';

const GRANULAR = [
  'openapi-including-examples.json',
  'petshop-examples.yaml',
  'user-signedup-asyncapi.yaml',
  'account-asyncapi3.yaml',
];

describe('filterArtifact', () => {
  it.each(GRANULAR)('%s: keeps exactly the chosen examples, and still reads as the same kind', (name) => {
    const original = parseArtifact(fixture(name))!;
    // Every other example, so that each operation is likely to keep some and lose some.
    const keep = new Set(original.examples.filter((_, i) => i % 2 === 0).map(exampleKey));

    const content = filterArtifact(original, keep);
    const filtered = parseArtifact({ ...original.file, content })!;

    expect(filtered.kind).toBe(original.kind);
    expect(filtered.service).toEqual(original.service);
    expect(new Set(filtered.examples.map(exampleKey))).toEqual(keep);
  });

  it.each(GRANULAR)('%s: can keep nothing', (name) => {
    const original = parseArtifact(fixture(name))!;
    const filtered = parseArtifact({ ...original.file, content: filterArtifact(original, new Set()) })!;
    expect(filtered.kind).toBe(original.kind);
    expect(filtered.examples).toEqual([]);
  });

  it('returns the file untouched when everything is kept', () => {
    const original = parseArtifact(fixture('openapi-including-examples.json'))!;
    expect(filterArtifact(original, new Set(original.examples.map(exampleKey)))).toBe(original.file.content);
  });

  it('gives each AsyncAPI 2 operation its own copy of a shared message', () => {
    const original = parseArtifact(fixture('user-signedup-asyncapi.yaml'))!;
    const keep = new Set([exampleKey({ operation: 'SUBSCRIBE user/signedup', example: 'john' })]);
    const filtered = parseArtifact({ ...original.file, content: filterArtifact(original, keep) })!;
    expect(filtered.examples).toEqual([{ operation: 'SUBSCRIBE user/signedup', example: 'john' }]);
  });

  it('keeps a shared AsyncAPI 3 message example while one operation still wants it', () => {
    const original = parseArtifact(fixture('account-asyncapi3.yaml'))!;
    const keep = new Set([exampleKey({ operation: 'SEND sendUserSignedUp', example: 'bob' })]);
    expect(parseArtifact({ ...original.file, content: filterArtifact(original, keep) })!.examples).toEqual([
      { operation: 'SEND sendUserSignedUp', example: 'bob' },
    ]);
  });

  it('refuses kinds that load as a whole', () => {
    expect(() => filterArtifact(parseArtifact(fixture('films.graphql'))!, new Set())).toThrow(/one by one/);
  });
});

