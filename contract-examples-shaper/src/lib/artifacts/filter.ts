import { detectKind } from './detect';
import { parseDocument, serializeDocument } from './document';
import { handlers, type Keep } from './kinds';
import type { ExampleRef, ParsedArtifact } from './types';

export const exampleKey = (ref: ExampleRef): string => `${ref.operation}\u0000${ref.example}`;

/**
 * The artifact's content with only the given examples left in it, ready to be uploaded under the same name so that
 * it replaces what Microcks holds from that file. Everything that is not an example is left as it was.
 */
export function filterArtifact(artifact: ParsedArtifact, keep: ReadonlySet<string>): string {
  const handler = handlers[artifact.kind];
  if (!artifact.granular || !handler.filter) {
    throw new Error(`${artifact.file.name}: examples of a ${artifact.kind} file cannot be picked one by one`);
  }
  if (artifact.examples.every((ref) => keep.has(exampleKey(ref)))) return artifact.file.content;

  const doc = parseDocument(artifact.file.content, artifact.format);
  const predicate: Keep = (ref) => keep.has(exampleKey(ref));
  handler.filter(doc, predicate);
  const content = serializeDocument(doc, artifact.format);

  // Microcks picks an importer from the text alone; a rewrite that changed its mind would import something else.
  const kind = detectKind(content);
  if (kind !== artifact.kind) {
    throw new Error(`${artifact.file.name}: filtered content reads as ${kind ?? 'nothing'}, not ${artifact.kind}`);
  }
  return content;
}
