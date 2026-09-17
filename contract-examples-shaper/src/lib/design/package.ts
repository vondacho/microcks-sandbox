import { serializeDocument, type Json, type JsonObject } from '../artifacts/document';
import { exampleKey } from '../artifacts/filter';
import { parseArtifact } from '../artifacts/parse';
import type { SourceFile } from '../artifacts/types';
import { mergeSources } from '../sources';
import type { Draft } from './draft';
import { isJsonMediaType, type DesignContract } from './operations';

/** One file of a package: an APIExamples document for one contract. */
export interface PackagedFile {
  contractId: string;
  fileName: string;
  content: string;
  examples: number;
}

/** The source file a package becomes once added to the sources. Adding it again replaces it. */
export const packageSource = (file: PackagedFile): SourceFile => ({
  path: `designed/${file.fileName}`,
  name: file.fileName,
  content: file.content,
  origin: 'package',
});

/**
 * The sources with packages added. A source file of the same contract sharing a package's name is replaced by it:
 * Microcks keys examples by file name, so the two could not be loaded side by side anyway. Only the sources change;
 * the file on disk stays as it is.
 */
export function addPackagesToSources(
  sources: SourceFile[],
  files: PackagedFile[],
  designs: DesignContract[],
): { sources: SourceFile[]; replaced: SourceFile[] } {
  const added = files.map(packageSource);
  const replacedPaths = new Set(
    files.flatMap((f) => {
      const contract = designs.find((d) => d.contract.id === f.contractId)?.contract;
      return (contract?.files ?? []).filter((a) => a.file.name === f.fileName && a.file.path !== packageSource(f).path).map((a) => a.file.path);
    }),
  );
  return {
    sources: mergeSources(sources.filter((s) => !replacedPaths.has(s.path)), added),
    replaced: sources.filter((s) => replacedPaths.has(s.path)),
  };
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'api';

/** `pet-shop-api-v1-examples.yaml` */
export const defaultFileName = (design: DesignContract): string =>
  `${slug(design.contract.service.name)}-${slug(design.contract.service.version)}-examples.yaml`;

/** A JSON body as structured YAML when it parses, so the file reads well; anything else as the text it is. */
function body(text: string | undefined, mediaType: string | undefined): Json | undefined {
  if (text === undefined || text.trim() === '') return undefined;
  if (isJsonMediaType(mediaType)) {
    try {
      return JSON.parse(text) as Json;
    } catch {
      // Packaging refuses drafts with invalid JSON; kept as text for anyone calling this directly.
    }
  }
  return text;
}

const nonEmpty = (record: Record<string, string>): Record<string, string> | undefined => {
  const entries = Object.entries(record).filter(([, value]) => value !== '');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/** Drops undefined fields, which YAML would otherwise write as `null`. */
const compact = (object: Record<string, Json | undefined>): JsonObject =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as JsonObject;

function exampleItem(draft: Draft): JsonObject {
  const { request, response } = draft;
  const requestBody = body(request.body, request.mediaType);
  const responseBody = body(response.body, response.mediaType);
  return {
    request: compact({
      parameters: nonEmpty(request.parameters),
      headers: nonEmpty({
        ...(requestBody !== undefined && request.mediaType ? { 'Content-Type': request.mediaType } : {}),
        ...(response.mediaType ? { Accept: response.mediaType } : {}),
        ...request.headers,
      }),
      body: requestBody,
    }),
    response: compact({
      headers: nonEmpty(response.headers),
      mediaType: response.mediaType,
      // A string, as the APIExamples schema has it.
      status: response.status,
      body: responseBody,
    }),
  };
}

/**
 * The APIExamples document holding the drafts of one contract, operations in contract order and examples in the order
 * they were created. Read back before it is handed out: it must be recognized by Microcks' rules and hold exactly the
 * drafts.
 */
export function packageDrafts(design: DesignContract, drafts: Draft[], fileName = defaultFileName(design)): PackagedFile {
  const operations: JsonObject = {};
  const order = design.operations.map((op) => op.name);
  const sorted = [...drafts].sort(
    (a, b) => order.indexOf(a.operation) - order.indexOf(b.operation) || a.createdAt.localeCompare(b.createdAt),
  );
  for (const draft of sorted) {
    const examples = (operations[draft.operation] ??= {}) as JsonObject;
    examples[draft.name.trim()] = exampleItem(draft);
  }
  const document: JsonObject = {
    apiVersion: 'mocks.microcks.io/v1alpha1',
    kind: 'APIExamples',
    metadata: { name: design.contract.service.name, version: design.contract.service.version },
    operations,
  };
  const content = serializeDocument(document, 'yaml');

  const read = parseArtifact({ path: `designed/${fileName}`, name: fileName, content, origin: 'package' });
  const expected = new Set(sorted.map((d) => exampleKey({ operation: d.operation, example: d.name.trim() })));
  if (
    read?.kind !== 'apiexamples' ||
    read.service?.name !== design.contract.service.name ||
    read.service.version !== design.contract.service.version ||
    read.examples.length !== expected.size ||
    !read.examples.every((ref) => expected.has(exampleKey(ref)))
  ) {
    throw new Error(`${fileName} does not read back as the APIExamples of ${design.contract.id} it was built as.`);
  }
  return { contractId: design.contract.id, fileName, content, examples: sorted.length };
}
