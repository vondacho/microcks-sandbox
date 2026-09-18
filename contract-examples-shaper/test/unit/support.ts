import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceFile } from '../../src/lib/artifacts/types';

export const fixture = (name: string): SourceFile => ({
  path: `fixtures/${name}`,
  name,
  content: readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8'),
  origin: 'folder',
});

export const ALL_FIXTURES = [
  'openapi-including-examples.json',
  'petshop-behavior-collection.json',
  'petshop-examples.yaml',
  'petshop-metadata.yaml',
  'user-signedup-asyncapi.yaml',
  'account-asyncapi3.yaml',
  'films.graphql',
  'README.md',
];


/** A fixture folder as the browser reports a picked one: every file, with its path relative to the folder's parent. */
export function pickedFolder(name: string): SourceFile[] {
  const root = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  const walk = (dir: string): SourceFile[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return [{ path: `${name}/${relative(root, full)}`, name: entry, content: readFileSync(full, 'utf8'), origin: 'folder' as const }];
    });
  return walk(root);
}
