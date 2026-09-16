import YAML from 'yaml';
import type { ArtifactFormat } from './types';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

export function formatOf(content: string): ArtifactFormat {
  const head = content.trimStart();
  return head.startsWith('{') || head.startsWith('[') ? 'json' : 'yaml';
}

export function parseDocument(content: string, format: ArtifactFormat): Json {
  return format === 'json' ? JSON.parse(content) : YAML.parse(content);
}

/**
 * Writes a document back in the format it came in, laid out so that Microcks' line-based type detection still
 * recognizes it: pretty-printed JSON keeps `"_postman_id":` at the start of its own line, and block-style YAML
 * keeps `kind: APIExamples` on one line.
 */
export function serializeDocument(doc: Json, format: ArtifactFormat): string {
  if (format === 'json') return JSON.stringify(doc, null, 2) + '\n';
  return YAML.stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
}

/** Resolves an in-document `$ref` (`#/a/b~1c`) once. External references are left untouched. */
export function deref(root: Json, node: Json | undefined): Json | undefined {
  if (!isObject(node) || typeof node.$ref !== 'string' || !node.$ref.startsWith('#/')) return node;
  let current: Json | undefined = root;
  for (const raw of node.$ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    current = isObject(current) ? current[key] : Array.isArray(current) ? current[Number(key)] : undefined;
    if (current === undefined) return undefined;
  }
  return current;
}

/** Follows a chain of in-document references to its target. */
export function derefDeep(root: Json, node: Json | undefined): Json | undefined {
  const seen = new Set<Json>();
  let current = node;
  while (isObject(current) && typeof current.$ref === 'string' && current.$ref.startsWith('#/') && !seen.has(current)) {
    seen.add(current);
    current = deref(root, current);
  }
  return current;
}

/** Every `$ref` that points outside the document: those cannot be resolved once the file is uploaded alone. */
export function externalRefs(node: Json, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((child) => externalRefs(child, found));
  } else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) found.add(value);
      else externalRefs(value, found);
    }
  }
  return found;
}
