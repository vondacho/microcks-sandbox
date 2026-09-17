import type { Json } from '../artifacts/document';
import {
  concreteMediaType,
  isJsonMediaType,
  type DesignContent,
  type DesignContract,
  type DesignOperation,
  type DesignResponse,
} from './operations';
import { coerceParameter, sampleFromSchema, type SchemaValidator } from './schema';

/** An example being designed, before it is packaged. Values are kept as typed, so a half-written body survives. */
export interface Draft {
  id: string;
  /** `name:version` of the contract. */
  contractId: string;
  /** Microcks operation name: `PUT /api/pets/{id}`. */
  operation: string;
  name: string;
  request: {
    /** Path and query parameters, by name. */
    parameters: Record<string, string>;
    headers: Record<string, string>;
    mediaType?: string;
    body?: string;
  };
  response: {
    status: string;
    mediaType?: string;
    headers: Record<string, string>;
    body?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type IssueSeverity = 'error' | 'warning';

export interface DraftIssue {
  severity: IssueSeverity;
  /** `name`, `request.body`, `response.body`, `response.status`, `parameter:<name>`, `header:<name>`, `response.header:<name>` */
  field: string;
  message: string;
}

const pretty = (value: Json) => JSON.stringify(value, null, 2);

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** The response a new example starts with: the first success, else the first declared. */
export const defaultResponse = (op: DesignOperation): DesignResponse | undefined =>
  op.responses.find((r) => /^2/.test(r.status)) ?? op.responses[0];

/** A status Microcks can serve: `2XX` becomes `200`, `default` becomes `500`. */
export const concreteStatus = (status: string): string =>
  status === 'default' ? '500' : /^[1-5]XX$/i.test(status) ? `${status[0]}00` : status;

/** A body sampled from the schema of a content, as JSON text; empty for non-JSON content. */
export function sampleBody(design: DesignContract, content: DesignContent | undefined): string | undefined {
  if (!content) return undefined;
  if (!isJsonMediaType(content.mediaType)) return '';
  return pretty(sampleFromSchema(design.document, content.schema));
}

export function newDraft(design: DesignContract, op: DesignOperation, name: string, now = new Date()): Draft {
  const requestContent = op.requestBody?.contents[0];
  const response = defaultResponse(op);
  const responseContent = response?.contents[0];
  const sample = (schema: Parameters<typeof sampleFromSchema>[1]) => {
    const value = sampleFromSchema(design.document, schema);
    return value === null || typeof value === 'object' ? '' : String(value);
  };
  return {
    id: newId(),
    contractId: design.contract.id,
    operation: op.name,
    name,
    request: {
      parameters: Object.fromEntries(op.parameters.filter((p) => p.in === 'path' || p.in === 'query').filter((p) => p.required).map((p) => [p.name, sample(p.schema)])),
      headers: Object.fromEntries(op.parameters.filter((p) => p.in === 'header' && p.required).map((p) => [p.name, sample(p.schema)])),
      mediaType: requestContent ? concreteMediaType(requestContent.mediaType) : undefined,
      body: sampleBody(design, requestContent),
    },
    response: {
      status: response ? concreteStatus(response.status) : '200',
      mediaType: responseContent ? concreteMediaType(responseContent.mediaType) : undefined,
      headers: Object.fromEntries((response?.headers ?? []).filter((h) => h.required).map((h) => [h.name, sample(h.schema)])),
      body: sampleBody(design, responseContent),
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function duplicateDraft(draft: Draft, name: string, now = new Date()): Draft {
  return { ...structuredClone(draft), id: newId(), name, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

/** A name not yet used by the given ones: `example`, `example_2`... */
export function freshName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** The declared response a status falls under: exact, then `2XX`-style range, then `default`. */
export function responseFor(op: DesignOperation, status: string): DesignResponse | undefined {
  return (
    op.responses.find((r) => r.status === status) ??
    op.responses.find((r) => /^[1-5]XX$/i.test(r.status) && r.status[0] === status[0]) ??
    op.responses.find((r) => r.status === 'default')
  );
}

const contentFor = (contents: DesignContent[], mediaType: string | undefined): DesignContent | undefined =>
  contents.find((c) => c.mediaType === mediaType) ??
  contents.find((c) => c.mediaType.includes('*')) ??
  (contents.length === 1 ? contents[0] : undefined);

export interface IssueContext {
  design: DesignContract;
  validator: SchemaValidator;
  /** Other drafts of the same operation, to catch duplicate names. */
  siblings: Draft[];
  /** Names of the examples the sources already hold for the operation. */
  existing: string[];
}

/**
 * What stands between a draft and a usable example. Errors keep it out of a package. Anything the contract's schemas
 * reject is only a warning: an example of a 400 is expected to carry a request the contract rejects.
 */
export function draftIssues(draft: Draft, op: DesignOperation | undefined, ctx: IssueContext): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const error = (field: string, message: string) => issues.push({ severity: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ severity: 'warning', field, message });

  const name = draft.name.trim();
  if (!name) error('name', 'An example needs a name.');
  else if (ctx.siblings.some((d) => d.id !== draft.id && d.name.trim() === name)) error('name', `Another draft of ${draft.operation} is named ${name}.`);
  else if (ctx.existing.includes(name)) warn('name', `The sources already hold an example ${name} for this operation: Microcks would serve two with that name.`);

  if (!op) {
    error('operation', `The contract has no operation ${draft.operation} any more.`);
    return issues;
  }

  for (const p of op.parameters) {
    if (p.in === 'cookie') continue;
    const values = p.in === 'header' ? draft.request.headers : draft.request.parameters;
    const field = p.in === 'header' ? `header:${p.name}` : `parameter:${p.name}`;
    const value = values[p.name];
    if (value === undefined || value === '') {
      // Microcks builds the mock's resource path from the path parameters: without one, the example can't be served.
      if (p.in === 'path') error(field, `The path parameter ${p.name} needs a value.`);
      else if (p.required) warn(field, `${p.name} is required by the contract.`);
      continue;
    }
    for (const issue of ctx.validator.validate(p.schema, coerceParameter(ctx.design.document, p.schema, value))) {
      warn(field, `${p.name}${issue.path} ${issue.message}`);
    }
  }

  checkBody(draft.request.body, draft.request.mediaType, op.requestBody?.contents ?? [], 'request.body', ctx, issues);
  if (op.requestBody?.required && !draft.request.body?.trim()) warn('request.body', 'The contract requires a request body.');

  const response = responseFor(op, draft.response.status);
  if (!/^[1-5]\d\d$/.test(draft.response.status)) error('response.status', 'The status must be an HTTP status code, like 200.');
  else if (!response) warn('response.status', `The contract declares no ${draft.response.status} response for this operation.`);
  for (const header of response?.headers ?? []) {
    if (header.required && !draft.response.headers[header.name]) warn(`response.header:${header.name}`, `${header.name} is required by the contract.`);
  }
  checkBody(draft.response.body, draft.response.mediaType, response?.contents ?? [], 'response.body', ctx, issues);
  return issues;
}

function checkBody(body: string | undefined, mediaType: string | undefined, contents: DesignContent[], field: string, ctx: IssueContext, issues: DraftIssue[]) {
  if (!body?.trim() || !isJsonMediaType(mediaType)) return;
  let value: Json;
  try {
    value = JSON.parse(body);
  } catch (e) {
    issues.push({ severity: 'error', field, message: `Not valid JSON: ${(e as Error).message}` });
    return;
  }
  const content = contentFor(contents, mediaType);
  for (const issue of ctx.validator.validate(content?.schema, value)) {
    issues.push({ severity: 'warning', field, message: `${issue.path || 'The body'} ${issue.message}` });
  }
}

export const hasErrors = (issues: DraftIssue[]): boolean => issues.some((i) => i.severity === 'error');
