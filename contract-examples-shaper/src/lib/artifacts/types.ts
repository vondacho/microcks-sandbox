/** A file as picked from a folder or fetched from a URL, before anything is known about it. */
export interface SourceFile {
  /** Where it came from: a path relative to the picked folder, or the URL. Unique within a catalog. */
  path: string;
  /** The artifact name Microcks will know it by: the multipart filename of the upload. */
  name: string;
  content: string;
  origin: 'folder' | 'url';
}

/** What Microcks' MockRepositoryImporterFactory would take the file for. */
export type ArtifactKind =
  | 'openapi'
  | 'swagger'
  | 'asyncapi2'
  | 'asyncapi3'
  | 'postman'
  | 'postman-workspace'
  | 'apiexamples'
  | 'apimetadata'
  | 'graphql'
  | 'grpc'
  | 'soapui'
  | 'har';

export type ArtifactRole = 'primary' | 'secondary';

export type ArtifactFormat = 'json' | 'yaml' | 'text';

export interface ServiceRef {
  name: string;
  version: string;
}

/** One example, keyed the way Microcks keys messages: by operation name and example name. */
export interface ExampleRef {
  operation: string;
  example: string;
}

export interface ParsedArtifact {
  file: SourceFile;
  kind: ArtifactKind;
  role: ArtifactRole;
  format: ArtifactFormat;
  /** Unknown for kinds whose identity cannot be read client-side (gRPC, SoapUI). */
  service?: ServiceRef;
  /** Examples found in the file, in document order. */
  examples: ExampleRef[];
  /** Whether a subset of `examples` can be written back out; otherwise the file loads as a whole. */
  granular: boolean;
  warnings: string[];
}

export const serviceId = (s: ServiceRef): string => `${s.name}:${s.version}`;
