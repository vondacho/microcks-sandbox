import { derefDeep, isObject, type Json, type JsonObject } from './document';
import type { ArtifactKind, ExampleRef, ServiceRef } from './types';

/** Decides, per example, whether it stays in a filtered artifact. */
export type Keep = (ref: ExampleRef) => boolean;

/**
 * What the shaper knows about one artifact kind. `examples` and `filter` walk the document the same way, so that
 * filtering and then listing again gives exactly the examples that were kept (see filter.test.ts).
 */
export interface KindHandler {
  identity(doc: Json, content: string): ServiceRef | undefined;
  /** `undefined` when some example cannot be named the way Microcks will name it, so it can't be picked alone. */
  examples(doc: Json): ExampleRef[] | undefined;
  /** Mutates `doc`. Only called for kinds whose `examples` returned a list. */
  filter?(doc: Json, keep: Keep): void;
}

const infoIdentity = (doc: Json): ServiceRef | undefined => {
  const info = isObject(doc) ? doc.info : undefined;
  return isObject(info) && info.title != null && info.version != null
    ? { name: String(info.title), version: String(info.version) }
    : undefined;
};

const metadataIdentity = (doc: Json): ServiceRef | undefined => {
  const metadata = isObject(doc) ? doc.metadata : undefined;
  return isObject(metadata) && metadata.name != null && metadata.version != null
    ? { name: String(metadata.name), version: String(metadata.version) }
    : undefined;
};

/** `microcksId: <name>:<version>` as a GraphQL comment or a HAR log comment line. */
const microcksIdIdentity = (text: string): ServiceRef | undefined => {
  const match = /microcksId:\s*([^:\r\n]+):([^\r\n]+)/.exec(text);
  return match ? { name: match[1].trim(), version: match[2].trim() } : undefined;
};

const entries = (node: Json | undefined): [string, Json][] => (isObject(node) ? Object.entries(node) : []);

const clone = <T extends Json>(node: T): T => structuredClone(node);

/* ------------------------------------------------------------------------------------------------ OpenAPI 3 */

const HTTP_VERBS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

interface OpenApiOperation {
  name: string;
  node: JsonObject;
}

function openApiOperations(doc: Json): OpenApiOperation[] {
  const result: OpenApiOperation[] = [];
  const collect = (items: Json | undefined, naming: (key: string, verb: string) => string) => {
    for (const [key, raw] of entries(items)) {
      for (const [verb, node] of entries(derefDeep(doc, raw))) {
        if (HTTP_VERBS.includes(verb) && isObject(node)) result.push({ name: naming(key.trim(), verb), node });
      }
    }
  };
  if (isObject(doc)) {
    collect(doc.paths, (path, verb) => `${verb.toUpperCase()} ${path}`);
    collect(doc.webhooks, (name) => `${name} WEBHOOK`);
  }
  return result;
}

/**
 * Microcks builds one message per named example under `responses.<code>.content.<type>.examples`; request bodies
 * and parameters only complete a message that a response example with the same name has started.
 * With `materialize`, references on the way are replaced by copies, so that filtering one operation never edits
 * a component another operation shares.
 */
function openApiExampleMaps(doc: Json, operation: JsonObject, materialize: boolean): JsonObject[] {
  const maps: JsonObject[] = [];
  const own = (holder: JsonObject, key: string): Json | undefined => {
    const target = derefDeep(doc, holder[key]);
    if (materialize && target !== holder[key] && target !== undefined) holder[key] = clone(target);
    return holder[key];
  };
  const responses = own(operation, 'responses');
  for (const code of Object.keys(isObject(responses) ? responses : {})) {
    const response = own(responses as JsonObject, code);
    const content = isObject(response) ? own(response, 'content') : undefined;
    for (const type of Object.keys(isObject(content) ? content : {})) {
      const media = own(content as JsonObject, type);
      const examples = isObject(media) ? own(media, 'examples') : undefined;
      if (isObject(examples)) maps.push(examples);
    }
  }
  return maps;
}

const openApi: KindHandler = {
  identity: infoIdentity,
  examples(doc) {
    const refs: ExampleRef[] = [];
    for (const op of openApiOperations(doc)) {
      const names = new Set(openApiExampleMaps(doc, op.node, false).flatMap((m) => Object.keys(m)));
      names.forEach((example) => refs.push({ operation: op.name, example }));
    }
    return refs;
  },
  filter(doc, keep) {
    for (const op of openApiOperations(doc)) {
      for (const map of openApiExampleMaps(doc, op.node, true)) {
        for (const example of Object.keys(map)) {
          if (!keep({ operation: op.name, example })) delete map[example];
        }
      }
    }
  },
};

/* ------------------------------------------------------------------------------------------------ AsyncAPI */

interface MessageExamples {
  operation: string;
  /** The message object whose `examples` array holds the examples. */
  message: JsonObject;
}

interface NamedMessageExamples extends MessageExamples {
  /** Name of each entry of `message.examples`, or undefined when Microcks would make one up. */
  names: (string | undefined)[];
}

/** An AsyncAPI 2 example is `{name, payload}`, or Microcks' own `{<name>: {payload}}` notation. */
function asyncApi2Names(example: Json): string[] | undefined {
  if (!isObject(example)) return undefined;
  if (typeof example.name === 'string') return [example.name];
  if ('payload' in example || 'headers' in example) return undefined;
  return Object.keys(example);
}

function asyncApi2Messages(doc: Json): MessageExamples[] {
  const result: MessageExamples[] = [];
  if (!isObject(doc)) return result;
  for (const [channel, rawChannel] of entries(doc.channels)) {
    for (const [verb, rawOperation] of entries(derefDeep(doc, rawChannel))) {
      if ((verb !== 'subscribe' && verb !== 'publish') || !isObject(rawOperation)) continue;
      const name = `${verb.toUpperCase()} ${channel.trim()}`;
      const message = derefDeep(doc, rawOperation.message);
      const messages = isObject(message) && Array.isArray(message.oneOf) ? message.oneOf : [message];
      for (const candidate of messages) {
        const resolved = derefDeep(doc, candidate);
        if (isObject(resolved) && Array.isArray(resolved.examples)) {
          result.push({ operation: name, message: resolved });
        }
      }
    }
  }
  return result;
}

const asyncApi2: KindHandler = {
  identity: infoIdentity,
  examples(doc) {
    const refs: ExampleRef[] = [];
    for (const { operation, message } of asyncApi2Messages(doc)) {
      for (const example of message.examples as Json[]) {
        const names = asyncApi2Names(example);
        if (!names) return undefined;
        names.forEach((name) => refs.push({ operation, example: name }));
      }
    }
    return refs;
  },
  filter(doc, keep) {
    // Channels may share a message through a reference: give each operation its own copy before filtering.
    if (!isObject(doc)) return;
    for (const [channel, rawChannel] of entries(doc.channels)) {
      for (const [verb, operation] of entries(derefDeep(doc, rawChannel))) {
        if ((verb !== 'subscribe' && verb !== 'publish') || !isObject(operation)) continue;
        const opName = `${verb.toUpperCase()} ${channel.trim()}`;
        const message = derefDeep(doc, operation.message);
        if (!isObject(message)) continue;
        const own = clone(message);
        operation.message = own;
        const candidates = Array.isArray(own.oneOf) ? own.oneOf : [own];
        candidates.forEach((candidate, i) => {
          const resolved = derefDeep(doc, candidate);
          if (!isObject(resolved) || !Array.isArray(resolved.examples)) return;
          const target = candidate === own ? own : clone(resolved);
          if (candidate !== own) (own.oneOf as Json[])[i] = target;
          target.examples = (resolved.examples as Json[]).flatMap((example): Json[] => {
            if (isObject(example) && typeof example.name === 'string') {
              return keep({ operation: opName, example: example.name }) ? [example] : [];
            }
            const kept = Object.fromEntries(
              entries(example).filter(([name]) => keep({ operation: opName, example: name })),
            );
            return Object.keys(kept).length > 0 ? [kept] : [];
          });
        });
      }
    }
  },
};

function asyncApi3Messages(doc: Json): NamedMessageExamples[] {
  const result: NamedMessageExamples[] = [];
  if (!isObject(doc)) return result;
  for (const [key, rawOperation] of entries(doc.operations)) {
    const operation = derefDeep(doc, rawOperation);
    if (!isObject(operation) || !Array.isArray(operation.messages)) continue;
    const name = `${String(operation.action ?? '').toUpperCase()} ${key}`;
    for (const ref of operation.messages) {
      const message = derefDeep(doc, ref);
      if (!isObject(message) || !Array.isArray(message.examples)) continue;
      // Microcks names an unnamed example `<message>-<position>`, which filtering would shift: those can't be
      // picked alone.
      const names = message.examples.map((example) =>
        isObject(example) && typeof example.name === 'string' ? example.name : undefined,
      );
      result.push({ operation: name, message, names });
    }
  }
  return result;
}

const asyncApi3: KindHandler = {
  identity: infoIdentity,
  examples(doc) {
    const refs: ExampleRef[] = [];
    for (const { operation, names } of asyncApi3Messages(doc)) {
      for (const name of names) {
        if (name === undefined) return undefined;
        refs.push({ operation, example: name });
      }
    }
    return refs;
  },
  filter(doc, keep) {
    // Operations reference channel messages and cannot be given private copies, so a message shared by several
    // operations keeps an example as long as one of them does.
    const kept = new Map<JsonObject, Set<number>>();
    for (const { operation, message, names } of asyncApi3Messages(doc)) {
      const indexes = kept.get(message) ?? new Set<number>();
      names.forEach((name, i) => {
        if (name !== undefined && keep({ operation, example: name })) indexes.add(i);
      });
      kept.set(message, indexes);
    }
    for (const [message, indexes] of kept) {
      message.examples = (message.examples as Json[]).filter((_, i) => indexes.has(i));
    }
  },
};

/* ------------------------------------------------------------------------------------------------ Postman */

const METHOD_PREFIX = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+\S/i;

function postmanPath(request: JsonObject): string {
  const url = request.url;
  let raw = typeof url === 'string' ? url : isObject(url) && typeof url.raw === 'string' ? url.raw : '';
  raw = raw.replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/^\{\{[^}]+\}\}/, '').split('?')[0];
  return raw.replace(/:([A-Za-z0-9_]+)/g, '{$1}') || '/';
}

function postmanItems(node: Json | undefined, found: { operation: string; item: JsonObject }[] = []) {
  for (const item of Array.isArray(node) ? node : []) {
    if (!isObject(item)) continue;
    if (isObject(item.request)) {
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const method = String(item.request.method ?? 'GET').toUpperCase();
      found.push({ operation: METHOD_PREFIX.test(name) ? name : `${method} ${postmanPath(item.request)}`, item });
    } else {
      postmanItems(item.item, found);
    }
  }
  return found;
}

const collectionOf = (doc: Json, kind: 'postman' | 'postman-workspace'): Json | undefined =>
  kind === 'postman' ? doc : isObject(doc) ? doc.collection : undefined;

function postman(kind: 'postman' | 'postman-workspace'): KindHandler {
  return {
    identity(doc) {
      const collection = collectionOf(doc, kind);
      const info = isObject(collection) ? collection.info : undefined;
      if (!isObject(info) || info.name == null) return undefined;
      let version: string | undefined;
      if (typeof info.version === 'string') version = info.version;
      else if (isObject(info.version)) {
        version = ['major', 'minor', 'patch'].map((k) => (info.version as JsonObject)[k] ?? 0).join('.');
      } else if (typeof info.description === 'string' && info.description.includes('version=')) {
        version = info.description.slice(info.description.indexOf('version=') + 8).split(' ')[0];
      }
      return version ? { name: String(info.name), version } : undefined;
    },
    examples(doc) {
      const collection = collectionOf(doc, kind);
      return postmanItems(isObject(collection) ? collection.item : undefined).flatMap(({ operation, item }) =>
        (Array.isArray(item.response) ? item.response : [])
          .filter(isObject)
          .map((response) => ({ operation, example: String(response.name ?? '') })),
      );
    },
    filter(doc, keep) {
      const collection = collectionOf(doc, kind);
      for (const { operation, item } of postmanItems(isObject(collection) ? collection.item : undefined)) {
        if (!Array.isArray(item.response)) continue;
        item.response = item.response.filter(
          (response) => isObject(response) && keep({ operation, example: String(response.name ?? '') }),
        );
      }
    },
  };
}

/* ------------------------------------------------------------------------------------------------ APIExamples */

const apiExamples: KindHandler = {
  identity: metadataIdentity,
  examples(doc) {
    const operations = isObject(doc) ? doc.operations : undefined;
    return entries(operations).flatMap(([operation, examples]) =>
      Object.keys(isObject(examples) ? examples : {}).map((example) => ({ operation, example })),
    );
  },
  filter(doc, keep) {
    if (!isObject(doc) || !isObject(doc.operations)) return;
    for (const [operation, examples] of Object.entries(doc.operations)) {
      if (!isObject(examples)) continue;
      for (const example of Object.keys(examples)) {
        if (!keep({ operation, example })) delete examples[example];
      }
      // An operation with no examples left goes, but the (possibly empty) map stays: the file is still valid.
      if (Object.keys(examples).length === 0) delete doc.operations[operation];
    }
  },
};

/* ------------------------------------------------------------------------------------------------ Whole-file kinds */

const noExamples = (identity: KindHandler['identity']): KindHandler => ({ identity, examples: () => [] });

const wholeFile = (identity: KindHandler['identity']): KindHandler => ({ identity, examples: () => undefined });

export const handlers: Record<ArtifactKind, KindHandler> = {
  openapi: openApi,
  asyncapi2: asyncApi2,
  asyncapi3: asyncApi3,
  postman: postman('postman'),
  'postman-workspace': postman('postman-workspace'),
  apiexamples: apiExamples,
  apimetadata: noExamples(metadataIdentity),
  swagger: wholeFile(infoIdentity),
  graphql: wholeFile((_, content) => microcksIdIdentity(content)),
  har: wholeFile((doc) => {
    const log = isObject(doc) ? doc.log : undefined;
    return isObject(log) && typeof log.comment === 'string' ? microcksIdIdentity(log.comment) : undefined;
  }),
  // Their service name lives in the protobuf package or the SoapUI project; Microcks reports it on upload.
  grpc: wholeFile(() => undefined),
  soapui: wholeFile(() => undefined),
};

/** Kinds that are not JSON or YAML documents. */
export const TEXT_KINDS: ReadonlySet<ArtifactKind> = new Set(['graphql', 'grpc', 'soapui']);
