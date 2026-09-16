import type { ArtifactKind, ArtifactRole } from './types';

// The same pragmas, in the same order, as Microcks' MockRepositoryImporterFactory: the first trimmed line
// that matches any rule decides. A file matching none falls back to HAR over there; here it stays unrecognized
// unless it really looks like a HAR, so that READMEs and $ref'd schema files don't show up as contracts.
const OPENAPI_3 = /^.*['"]?openapi['"]?\s*:\s*['"]?[3.].*$/;
const SWAGGER = /^.*['"]?swagger['"]?\s*:\s*.*$/;
const ASYNCAPI_2 = /^.*['"]?asyncapi['"]?\s*:\s*['"]?[2.].*$/;
const ASYNCAPI_3 = /^.*['"]?asyncapi['"]?\s*:\s*['"]?[3.].*$/;

function detectLine(line: string): ArtifactKind | undefined {
  if (line.startsWith('"_postman_id":')) return 'postman';
  if (line.startsWith('"collection":') || line.startsWith('{"collection":')) return 'postman-workspace';
  if (OPENAPI_3.test(line)) return 'openapi';
  if (SWAGGER.test(line)) return 'swagger';
  if (line.startsWith('<?xml')) return 'soapui';
  if (ASYNCAPI_2.test(line)) return 'asyncapi2';
  if (ASYNCAPI_3.test(line)) return 'asyncapi3';
  if (line.startsWith('syntax = "proto3";') || line.startsWith('syntax="proto3";')) return 'grpc';
  if (line.includes('kind: APIMetadata')) return 'apimetadata';
  if (line.includes('kind: APIExamples')) return 'apiexamples';
  if (line.includes('type Query {') || line.includes('type Mutation {') || line.startsWith('# microcksId:')) {
    return 'graphql';
  }
  return undefined;
}

export function detectKind(content: string): ArtifactKind | undefined {
  for (const raw of content.split(/\r?\n|\r/)) {
    const kind = detectLine(raw.trim());
    if (kind) return kind;
  }
  if (/"log"\s*:\s*\{/.test(content) && /"entries"\s*:/.test(content) && content.includes('microcksId:')) {
    return 'har';
  }
  return undefined;
}

/**
 * The role an artifact of this kind plays. Contracts create services; examples and metadata only enrich one.
 * A Postman collection can be either, but in a folder next to a contract it is a companion, so that's the default
 * when the catalog finds a primary for the same service (see catalog.ts).
 */
export function defaultRole(kind: ArtifactKind): ArtifactRole {
  return kind === 'apiexamples' || kind === 'apimetadata' ? 'secondary' : 'primary';
}
