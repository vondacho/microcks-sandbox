import { serializeDocument, type JsonObject } from './document';
import type { ServiceRef, SourceFile } from './types';

/*
 * A file Microcks cannot read may still be one example's response body, if its path says what it answers:
 *
 *   v1/pets/GET_200_all-pets.json        → GET /pets, 200, example `all-pets`
 *   v1/pets/999/GET_404_unknown-pet.json → GET /pets/{id} with id 999, 404, example `unknown-pet`
 *
 * The first folder is the API version, the folders under it are the endpoint's URI as called, and the name gives the
 * status code and the example's name. Only GET is read: nothing in such a file says what a request would carry
 * beyond its URI. The catalog matches the URI against the contract's paths, which gives the operation and the value
 * of each path parameter, and turns the files into an APIExamples artifact that loads like any other.
 */

/** A folder naming an API version: `v1`, `v2.1`, `v1beta`. */
const VERSION = /^v[0-9][\w.-]*$/i;

/** `GET_200_all-pets.json`: the status code, then the example's name up to the extension. */
const NAME = /^GET_(\d{3})_(.+)\.json$/;

export interface BodyFile {
  file: SourceFile;
  /** The version folder, as written: `v1`. */
  version: string;
  /** The endpoint's URI as called: `/pets/999`. */
  uri: string;
  status: string;
  example: string;
}

/** A body file placed against the contract: the operation it answers, and the path parameters its URI gives. */
export interface MatchedBodyFile extends BodyFile {
  /** Microcks operation name: `GET /pets/{id}`. */
  operation: string;
  parameters: Record<string, string>;
}

/**
 * Reads a path as one example's response body, or nothing when it does not say what it answers. The URI needs the
 * folders around the file, so a file picked on its own or fetched from a URL never matches.
 */
export function readBodyFile(file: SourceFile): BodyFile | undefined {
  const segments = file.path.split('/').filter(Boolean);
  const name = segments.pop();
  if (!name) return undefined;
  const named = NAME.exec(name);
  if (!named) return undefined;

  // Anything above the version folder is where the tree happens to live, the picked folder's own name included.
  const root = segments.findIndex((segment) => VERSION.test(segment));
  if (root < 0) return undefined;
  const uri = segments.slice(root + 1);
  if (uri.length === 0) return undefined;

  return {
    file,
    version: segments[root],
    uri: `/${uri.join('/')}`,
    status: named[1],
    example: named[2],
  };
}

/**
 * The operation of the contract a URI calls, and what its path parameters hold: `/pets/999` calls `GET /pets/{id}`
 * with `id` at 999. A URI matching no declared path belongs to no operation.
 */
export function matchOperation(declared: string[], uri: string): { operation: string; parameters: Record<string, string> } | undefined {
  const called = uri.split('/').filter(Boolean);
  for (const operation of declared) {
    const [method, path] = operation.split(' ');
    if (method !== 'GET' || path === undefined) continue;
    const template = path.split('/').filter(Boolean);
    if (template.length !== called.length) continue;
    const parameters: Record<string, string> = {};
    const fits = template.every((segment, i) => {
      const placeholder = /^\{(.+)\}$/.exec(segment);
      if (placeholder) parameters[placeholder[1]] = called[i];
      return placeholder ? called[i].length > 0 : segment === called[i];
    });
    if (fits) return { operation, parameters };
  }
  return undefined;
}

/** Whether a version folder names this service's version: `v1` for `v1`, and for `1` too. */
export const versionMatches = (service: ServiceRef, version: string): boolean =>
  service.version === version || service.version === version.replace(/^v/i, '');

/** `pet-shop-api-v1-body-files.yaml` */
const fileName = (service: ServiceRef): string =>
  `${[service.name, service.version].map((part) => part.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '')).join('-')}-body-files.yaml`;

/**
 * The body files of one service as an APIExamples artifact: a source file of its own, which the catalog reads like
 * any other and the load journey imports as a secondary artifact. Its name is what Microcks tracks those examples
 * under, so it stays the same as long as the service does.
 */
export function toApiExamples(service: ServiceRef, bodies: MatchedBodyFile[]): SourceFile {
  const operations: JsonObject = {};
  for (const body of bodies) {
    const examples = (operations[body.operation] ??= {}) as JsonObject;
    const request: JsonObject = { headers: { Accept: 'application/json' } };
    if (Object.keys(body.parameters).length > 0) request.parameters = body.parameters;
    examples[body.example] = {
      request,
      response: { mediaType: 'application/json', status: body.status, body: body.file.content.trim() },
    };
  }
  const content = serializeDocument(
    {
      apiVersion: 'mocks.microcks.io/v1alpha1',
      kind: 'APIExamples',
      metadata: { name: service.name, version: service.version },
      operations,
    },
    'yaml',
  );
  const name = fileName(service);
  return { path: `generated/${name}`, name, content, origin: 'generated' };
}
