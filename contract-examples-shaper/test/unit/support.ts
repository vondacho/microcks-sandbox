import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SourceFile } from '../../src/lib/artifacts/types';

export const fixture = (name: string): SourceFile => ({
  path: `fixtures/${name}`,
  name,
  content: readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8'),
  origin: 'folder',
});

export const ALL_FIXTURES = [
  'openapi-examples.json',
  'petshop-behavior-collection.json',
  'petshop-examples.yaml',
  'petshop-metadata.yaml',
  'user-signedup-asyncapi.yaml',
  'account-asyncapi3.yaml',
  'films.graphql',
  'README.md',
];
