import type { Contract } from '../artifacts/catalog';
import { derefDeep, isObject, parseDocument, type Json, type JsonObject } from '../artifacts/document';
import type { ParsedArtifact } from '../artifacts/types';

/** What an operation of a contract declares, as far as designing an example of it goes. */
export interface DesignOperation {
  /** As Microcks names it: `PUT /api/pets/{id}`. */
  name: string;
  method: string;
  path: string;
  summary?: string;
  parameters: DesignParameter[];
  requestBody?: { required: boolean; contents: DesignContent[] };
  responses: DesignResponse[];
}

export interface DesignParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema?: JsonObject;
  description?: string;
}

export interface DesignContent {
  mediaType: string;
  schema?: JsonObject;
}

export interface DesignResponse {
  /** `200`, `4XX`, `default`... */
  status: string;
  description?: string;
  contents: DesignContent[];
  headers: { name: string; required: boolean; schema?: JsonObject }[];
}

/** A contract examples can be designed for: an OpenAPI 3 one, parsed. */
export interface DesignContract {
  contract: Contract;
  artifact: ParsedArtifact;
  document: JsonObject;
  /** `3.0` or `3.1`: they validate schemas differently. */
  openapi: '3.0' | '3.1';
  operations: DesignOperation[];
}

const HTTP_VERBS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const asObject = (doc: Json, node: Json | undefined): JsonObject | undefined => {
  const resolved = derefDeep(doc, node);
  return isObject(resolved) ? resolved : undefined;
};

function contents(doc: Json, node: Json | undefined): DesignContent[] {
  return Object.entries(asObject(doc, node) ?? {}).map(([mediaType, raw]) => {
    const media = asObject(doc, raw);
    return { mediaType, schema: isObject(media?.schema) ? media.schema : undefined };
  });
}

function parameters(doc: Json, ...lists: (Json | undefined)[]): DesignParameter[] {
  // Operation parameters override path-level ones with the same name and location.
  const byKey = new Map<string, DesignParameter>();
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      const p = asObject(doc, raw);
      if (!p || typeof p.name !== 'string' || typeof p.in !== 'string') continue;
      const location = p.in as DesignParameter['in'];
      byKey.set(`${location}:${p.name}`, {
        name: p.name,
        in: location,
        required: location === 'path' || p.required === true,
        schema: isObject(p.schema) ? p.schema : undefined,
        description: typeof p.description === 'string' ? p.description : undefined,
      });
    }
  }
  return [...byKey.values()];
}

/**
 * The operations of an OpenAPI document, named as Microcks names them. Schemas are kept as written, references
 * included: they are resolved against the document when validating.
 */
export function designOperations(doc: JsonObject): DesignOperation[] {
  const operations: DesignOperation[] = [];
  for (const [path, rawItem] of Object.entries(asObject(doc, doc.paths) ?? {})) {
    const item = asObject(doc, rawItem);
    if (!item) continue;
    for (const verb of HTTP_VERBS) {
      const op = asObject(doc, item[verb]);
      if (!op) continue;
      const body = asObject(doc, op.requestBody);
      operations.push({
        name: `${verb.toUpperCase()} ${path.trim()}`,
        method: verb.toUpperCase(),
        path: path.trim(),
        summary: typeof op.summary === 'string' ? op.summary : undefined,
        parameters: parameters(doc, item.parameters, op.parameters),
        requestBody: body ? { required: body.required === true, contents: contents(doc, body.content) } : undefined,
        responses: Object.entries(asObject(doc, op.responses) ?? {}).map(([status, raw]) => {
          const response = asObject(doc, raw) ?? {};
          return {
            status,
            description: typeof response.description === 'string' ? response.description : undefined,
            contents: contents(doc, response.content),
            headers: Object.entries(asObject(doc, response.headers) ?? {}).map(([name, rawHeader]) => {
              const header = asObject(doc, rawHeader) ?? {};
              return { name, required: header.required === true, schema: isObject(header.schema) ? header.schema : undefined };
            }),
          };
        }),
      });
    }
  }
  return operations;
}

/** The contract as a design target, or why it can't be one. */
export function designContract(contract: Contract): DesignContract | { contract: Contract; reason: string } {
  const artifact = contract.primary;
  if (!artifact) return { contract, reason: 'The sources hold no contract for it, only companions.' };
  if (artifact.kind !== 'openapi') return { contract, reason: `Designing examples needs an OpenAPI 3 contract, not ${artifact.kind}.` };
  let document: Json;
  try {
    document = parseDocument(artifact.file.content, artifact.format);
  } catch (e) {
    return { contract, reason: `${artifact.file.name} cannot be parsed: ${(e as Error).message}` };
  }
  if (!isObject(document)) return { contract, reason: `${artifact.file.name} is not an OpenAPI document.` };
  return {
    contract,
    artifact,
    document,
    openapi: String(document.openapi).startsWith('3.0') ? '3.0' : '3.1',
    operations: designOperations(document),
  };
}

export const isDesignable = (d: ReturnType<typeof designContract>): d is DesignContract => 'operations' in d;

/** Whether a media type carries JSON: `application/json`, `application/problem+json`, or a wildcard. */
export const isJsonMediaType = (mediaType: string | undefined): boolean =>
  !mediaType || mediaType === '*/*' || /[/+]json(;|$)/i.test(mediaType);

/** The media type an example is written with: a wildcard in the contract becomes JSON. */
export const concreteMediaType = (mediaType: string | undefined): string =>
  !mediaType || mediaType.includes('*') ? 'application/json' : mediaType;
