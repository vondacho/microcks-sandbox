import { derefDeep, isObject, parseDocument, type Json, type JsonObject } from './artifacts/document';
import { postmanItems } from './artifacts/kinds';
import type { ExampleRef, ParsedArtifact } from './artifacts/types';
import type { Draft } from './design/draft';

/*
 * An example as someone reads it: the request that selects it and the response it gets, or the message of an event.
 * Built from wherever the example is: a source file, a draft, or what Microcks holds.
 */

export interface NameValue {
  name: string;
  value: string;
}

export interface ExchangePreview {
  operation: string;
  example: string;
  summary?: string;
  request?: {
    method?: string;
    /** The operation's path with its path parameters filled in, and query parameters appended. */
    path?: string;
    headers: NameValue[];
    mediaType?: string;
    body?: string;
  };
  response?: {
    status?: string;
    mediaType?: string;
    headers: NameValue[];
    body?: string;
    /** How Microcks picks this response for a request: `/id=5`, `?status=SOLD`... */
    dispatchCriteria?: string;
  };
  event?: {
    headers: NameValue[];
    mediaType?: string;
    payload?: string;
  };
}

/** A body as text: JSON values and JSON strings pretty-printed, anything else as it is. */
export function bodyText(value: Json | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Json;
      return typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed, null, 2) : value;
    } catch {
      return value;
    }
  }
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

const text = (value: Json | undefined): string =>
  typeof value === 'string' ? value : value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

/**
 * `PUT /api/pets/{id}` with `{id: 5}` → `PUT` and `/api/pets/5`. Parameters that fill no placeholder go to the query
 * string: Microcks keeps path and query parameters together, and tells them apart the same way.
 */
export function requestLine(operation: string, parameters: NameValue[]): { method?: string; path?: string } {
  const space = operation.indexOf(' ');
  if (space < 0) return {};
  const method = operation.slice(0, space);
  let path = operation.slice(space + 1);
  const query: NameValue[] = [];
  for (const p of parameters) {
    const placeholder = `{${p.name}}`;
    if (path.includes(placeholder)) path = path.replace(placeholder, encodeURIComponent(p.value));
    else if (path.includes(`/:${p.name}`)) path = path.replace(`/:${p.name}`, `/${encodeURIComponent(p.value)}`);
    else query.push(p);
  }
  const search = query.map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join('&');
  return { method, path: search ? `${path}?${search}` : path };
}

const entries = (node: Json | undefined): [string, Json][] => (isObject(node) ? Object.entries(node) : []);

/* ------------------------------------------------------------------------------------------------ Source files */

function fromOpenApi(doc: JsonObject, ref: ExampleRef): ExchangePreview | undefined {
  const space = ref.operation.indexOf(' ');
  const verb = ref.operation.slice(0, space).toLowerCase();
  const item = derefDeep(doc, isObject(doc.paths) ? doc.paths[ref.operation.slice(space + 1)] : undefined);
  const op = isObject(item) ? derefDeep(doc, item[verb]) : undefined;
  if (!isObject(item) || !isObject(op)) return undefined;

  /** The entry named after the example in an `examples` map, references followed. */
  const named = (examples: Json | undefined): JsonObject | undefined => {
    const map = derefDeep(doc, examples);
    const example = isObject(map) ? derefDeep(doc, map[ref.example]) : undefined;
    return isObject(example) ? example : undefined;
  };
  let summary: string | undefined;
  const valueOf = (example: JsonObject | undefined) => {
    if (example && typeof example.summary === 'string') summary ??= example.summary;
    return example?.value;
  };

  const pathAndQuery: NameValue[] = [];
  const requestHeaders: NameValue[] = [];
  for (const raw of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
    const p = derefDeep(doc, raw);
    if (!isObject(p) || typeof p.name !== 'string') continue;
    const example = named(p.examples);
    if (!example) continue;
    const entry = { name: p.name, value: text(valueOf(example)) };
    if (p.in === 'header') requestHeaders.push(entry);
    else if (p.in === 'path' || p.in === 'query') pathAndQuery.push(entry);
  }

  let request: ExchangePreview['request'];
  const requestBody = derefDeep(doc, op.requestBody);
  for (const [mediaType, media] of entries(isObject(requestBody) ? derefDeep(doc, requestBody.content) : undefined)) {
    const example = named(isObject(media) ? media.examples : undefined);
    if (example) {
      request = { headers: [], mediaType, body: bodyText(valueOf(example)) };
      break;
    }
  }

  let response: ExchangePreview['response'];
  for (const [status, raw] of entries(derefDeep(doc, op.responses))) {
    const r = derefDeep(doc, raw);
    if (!isObject(r)) continue;
    for (const [mediaType, media] of entries(derefDeep(doc, r.content))) {
      const example = named(isObject(media) ? media.examples : undefined);
      if (!example) continue;
      const headers = entries(derefDeep(doc, r.headers)).flatMap(([name, header]) => {
        const h = derefDeep(doc, header);
        const value = isObject(h) ? named(h.examples) : undefined;
        return value ? [{ name, value: text(valueOf(value)) }] : [];
      });
      response = { status, mediaType, headers, body: bodyText(valueOf(example)) };
      break;
    }
    if (response) break;
  }
  if (!response) return undefined;

  return {
    operation: ref.operation,
    example: ref.example,
    summary,
    request: { ...requestLine(ref.operation, pathAndQuery), headers: requestHeaders, mediaType: request?.mediaType, body: request?.body },
    response,
  };
}

const headerList = (node: Json | undefined): NameValue[] => entries(node).map(([name, value]) => ({ name, value: text(value) }));

function fromApiExamples(doc: JsonObject, ref: ExampleRef): ExchangePreview | undefined {
  const operation = isObject(doc.operations) ? doc.operations[ref.operation] : undefined;
  const example = isObject(operation) ? operation[ref.example] : undefined;
  if (!isObject(example)) return undefined;
  const base = { operation: ref.operation, example: ref.example };
  if (isObject(example.eventMessage)) {
    const m = example.eventMessage;
    return { ...base, event: { headers: headerList(m.headers), payload: bodyText(m.payload) } };
  }
  const request = isObject(example.request) ? example.request : {};
  const response = isObject(example.response) ? example.response : {};
  const headers = headerList(request.headers);
  return {
    ...base,
    request: {
      ...requestLine(ref.operation, headerList(request.parameters)),
      headers,
      mediaType: headers.find((h) => h.name.toLowerCase() === 'content-type')?.value,
      body: bodyText(request.body),
    },
    response: {
      status: response.status === undefined ? '200' : text(response.status),
      mediaType: typeof response.mediaType === 'string' ? response.mediaType : undefined,
      headers: headerList(response.headers),
      body: bodyText(response.body),
    },
  };
}

const postmanHeaders = (node: Json | undefined): NameValue[] =>
  (Array.isArray(node) ? node : []).filter(isObject).map((h) => ({ name: text(h.key), value: text(h.value) }));

function postmanUrl(url: Json | undefined): string | undefined {
  const raw = typeof url === 'string' ? url : isObject(url) && typeof url.raw === 'string' ? url.raw : undefined;
  return raw?.replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/^\{\{[^}]+\}\}/, '');
}

function fromPostman(collection: Json | undefined, ref: ExampleRef): ExchangePreview | undefined {
  const items = postmanItems(isObject(collection) ? collection.item : undefined).filter((i) => i.operation === ref.operation);
  for (const { item } of items) {
    const response = (Array.isArray(item.response) ? item.response : []).find((r) => isObject(r) && text(r.name) === ref.example);
    if (!isObject(response)) continue;
    const original = isObject(response.originalRequest) ? response.originalRequest : (item.request as JsonObject);
    const requestHeaders = postmanHeaders(original.header);
    const responseHeaders = postmanHeaders(response.header);
    return {
      operation: ref.operation,
      example: ref.example,
      request: {
        method: text(original.method) || 'GET',
        path: postmanUrl(original.url),
        headers: requestHeaders,
        mediaType: requestHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value,
        body: bodyText(isObject(original.body) ? original.body.raw : undefined),
      },
      response: {
        status: response.code === undefined ? undefined : text(response.code),
        mediaType: responseHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value,
        headers: responseHeaders,
        body: bodyText(response.body),
      },
    };
  }
  return undefined;
}

function asyncMessages(doc: JsonObject, ref: ExampleRef): JsonObject[] {
  const [action, ...rest] = ref.operation.split(' ');
  const key = rest.join(' ');
  if (String(doc.asyncapi).startsWith('3')) {
    const op = derefDeep(doc, isObject(doc.operations) ? doc.operations[key] : undefined);
    return (isObject(op) && Array.isArray(op.messages) ? op.messages : []).map((m) => derefDeep(doc, m)).filter(isObject);
  }
  const channel = derefDeep(doc, isObject(doc.channels) ? doc.channels[key] : undefined);
  const op = isObject(channel) ? channel[action.toLowerCase()] : undefined;
  const message = isObject(op) ? derefDeep(doc, op.message) : undefined;
  const candidates = isObject(message) && Array.isArray(message.oneOf) ? message.oneOf : [message];
  return candidates.map((m) => derefDeep(doc, m)).filter(isObject);
}

function fromAsyncApi(doc: JsonObject, ref: ExampleRef): ExchangePreview | undefined {
  for (const message of asyncMessages(doc, ref)) {
    for (const example of Array.isArray(message.examples) ? message.examples : []) {
      if (!isObject(example)) continue;
      // `{name, headers, payload}`, or Microcks' own `{<name>: {headers, payload}}`.
      const found = example.name === ref.example ? example : isObject(example[ref.example]) ? (example[ref.example] as JsonObject) : undefined;
      if (!found) continue;
      return {
        operation: ref.operation,
        example: ref.example,
        summary: typeof found.summary === 'string' ? found.summary : undefined,
        event: {
          headers: headerList(found.headers),
          mediaType: typeof message.contentType === 'string' ? message.contentType : typeof doc.defaultContentType === 'string' ? doc.defaultContentType : undefined,
          payload: bodyText(found.payload),
        },
      };
    }
  }
  return undefined;
}

/** An example of a source file, as the file declares it. Undefined when the file does not hold it. */
export function previewFromArtifact(artifact: ParsedArtifact, ref: ExampleRef): ExchangePreview | undefined {
  if (artifact.format === 'text') return undefined;
  let doc: Json;
  try {
    doc = parseDocument(artifact.file.content, artifact.format);
  } catch {
    return undefined;
  }
  if (!isObject(doc)) return undefined;
  switch (artifact.kind) {
    case 'openapi':
      return fromOpenApi(doc, ref);
    case 'apiexamples':
      return fromApiExamples(doc, ref);
    case 'postman':
      return fromPostman(doc, ref);
    case 'postman-workspace':
      return fromPostman(doc.collection, ref);
    case 'asyncapi2':
    case 'asyncapi3':
      return fromAsyncApi(doc, ref);
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------------------------------------ Drafts */

const nonEmpty = (record: Record<string, string>): NameValue[] =>
  Object.entries(record)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => ({ name, value }));

/** A draft as the exchange it describes, even half-written. */
export function previewFromDraft(draft: Draft): ExchangePreview {
  const body = (value: string | undefined) => (value?.trim() ? bodyText(value) : undefined);
  const requestBody = body(draft.request.body);
  return {
    operation: draft.operation,
    example: draft.name,
    request: {
      ...requestLine(draft.operation, nonEmpty(draft.request.parameters)),
      headers: nonEmpty(draft.request.headers),
      mediaType: requestBody ? draft.request.mediaType : undefined,
      body: requestBody,
    },
    response: {
      status: draft.response.status,
      mediaType: draft.response.mediaType,
      headers: nonEmpty(draft.response.headers),
      body: body(draft.response.body),
    },
  };
}

/* ------------------------------------------------------------------------------------------------ Microcks */

type Raw = Record<string, unknown>;
const record = (v: unknown): Raw => (typeof v === 'object' && v !== null ? (v as Raw) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Microcks headers are `[{name, values: [...]}]`. */
const microcksHeaders = (v: unknown): NameValue[] =>
  (Array.isArray(v) ? v : []).map(record).map((h) => ({
    name: String(h.name ?? ''),
    value: (Array.isArray(h.values) ? h.values : []).map(String).join(', '),
  }));

/**
 * One exchange of `GET /api/services/{id}?messages=true`, as Microcks serves it: `{request, response}` for a
 * request/response pair, `{eventMessage}` for an event.
 */
export function previewFromMicrocks(operation: string, raw: unknown): ExchangePreview {
  const exchange = record(raw);
  const request = record(exchange.request);
  const response = record(exchange.response);
  const event = record(exchange.eventMessage);
  const example = str(exchange.name) ?? str(response.name) ?? str(request.name) ?? str(event.name) ?? '';
  if (exchange.eventMessage) {
    return {
      operation,
      example,
      event: { headers: microcksHeaders(event.headers), mediaType: str(event.mediaType), payload: bodyText(str(event.content)) },
    };
  }
  const parameters = (Array.isArray(request.queryParameters) ? request.queryParameters : [])
    .map(record)
    .map((p) => ({ name: String(p.name ?? ''), value: String(p.value ?? '') }));
  const headers = microcksHeaders(request.headers);
  return {
    operation,
    example,
    request: {
      ...requestLine(operation, parameters),
      headers,
      mediaType: headers.find((h) => h.name.toLowerCase() === 'content-type')?.value,
      body: bodyText(str(request.content)),
    },
    response: {
      status: str(response.status),
      mediaType: str(response.mediaType),
      headers: microcksHeaders(response.headers),
      body: bodyText(str(response.content)),
      dispatchCriteria: str(response.dispatchCriteria) || undefined,
    },
  };
}
