import { defaultRole, detectKind } from './detect';
import { externalRefs, formatOf, parseDocument, type Json } from './document';
import { handlers, TEXT_KINDS } from './kinds';
import type { ParsedArtifact, SourceFile } from './types';

/** Reads one file the way Microcks would. Returns undefined for files Microcks would not recognize. */
export function parseArtifact(file: SourceFile): ParsedArtifact | undefined {
  const kind = detectKind(file.content);
  if (!kind) return undefined;

  const format = TEXT_KINDS.has(kind) ? 'text' : formatOf(file.content);
  const warnings: string[] = [];
  let doc: Json = null;
  if (format !== 'text') {
    try {
      doc = parseDocument(file.content, format);
    } catch (e) {
      warnings.push(`Cannot be parsed as ${format.toUpperCase()}: ${(e as Error).message}`);
    }
  }

  const handler = handlers[kind];
  const service = handler.identity(doc, file.content);
  if (!service && kind !== 'grpc' && kind !== 'soapui') {
    warnings.push('No service name and version found: Microcks will reject it.');
  }

  const examples = doc === null && format !== 'text' ? undefined : handler.examples(doc);
  if (examples === undefined && handler.filter) {
    warnings.push('Some examples have no name, so examples in this file can only be loaded all together.');
  }

  const refs = format === 'text' ? [] : [...externalRefs(doc)];
  if (refs.length > 0) {
    warnings.push(`References other files, which Microcks cannot resolve for an upload: ${refs.slice(0, 3).join(', ')}`);
  }

  return {
    file,
    kind,
    role: defaultRole(kind),
    format,
    service,
    examples: examples ?? [],
    granular: examples !== undefined && handler.filter !== undefined,
    warnings,
  };
}
