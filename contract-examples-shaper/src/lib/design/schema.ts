import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { derefDeep, isObject, type Json, type JsonObject } from '../artifacts/document';

/*
 * Schemas of an OpenAPI document: a sample value to start an example from, and validation of a value against them.
 * OpenAPI 3.1 schemas are JSON Schema 2020-12. OpenAPI 3.0 ones are a dialect: `nullable`, and boolean
 * `exclusiveMinimum`/`exclusiveMaximum`, are rewritten into draft-07 before validating.
 */

const MAX_DEPTH = 8;

/**
 * A value that satisfies the schema as far as reasonably guessable: the schema's own example, default, const or first
 * enum value when there is one; otherwise one built from its type, with every declared property.
 */
export function sampleFromSchema(doc: Json, schema: Json | undefined, depth = 0, seen = new Set<Json>()): Json {
  const resolved = derefDeep(doc, schema);
  if (!isObject(resolved) || depth > MAX_DEPTH || seen.has(resolved)) return null;
  const s = resolved;
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.examples) && s.examples.length > 0) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];

  const inner = new Set(seen).add(s);
  const next = (child: Json | undefined) => sampleFromSchema(doc, child, depth + 1, inner);

  if (Array.isArray(s.allOf)) {
    return s.allOf.reduce<Json>((merged, part) => {
      const value = next(part);
      return isObject(merged) && isObject(value) ? { ...merged, ...value } : (value ?? merged);
    }, {});
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const options = s[key];
    if (Array.isArray(options) && options.length > 0) return next(options[0]);
  }

  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  switch (type ?? (isObject(s.properties) ? 'object' : isObject(s.items) ? 'array' : undefined)) {
    case 'object':
      return Object.fromEntries(Object.entries(isObject(s.properties) ? s.properties : {}).map(([key, value]) => [key, next(value)]));
    case 'array':
      return [next(s.items)];
    case 'integer':
      return typeof s.minimum === 'number' ? Math.ceil(s.minimum) : 0;
    case 'number':
      return typeof s.minimum === 'number' ? s.minimum : 0;
    case 'boolean':
      return false;
    case 'string':
      return sampleString(typeof s.format === 'string' ? s.format : undefined);
    default:
      return null;
  }
}

function sampleString(format: string | undefined): string {
  switch (format) {
    case 'date-time':
      return '2026-01-01T12:00:00Z';
    case 'date':
      return '2026-01-01';
    case 'email':
      return 'someone@example.com';
    case 'uuid':
      return '00000000-0000-4000-8000-000000000000';
    case 'uri':
      return 'https://example.com/';
    default:
      return 'string';
  }
}

/** Rewrites OpenAPI 3.0 schema keywords into their JSON Schema draft-07 equivalents, on a copy. */
export function toDraft07(node: Json): Json {
  if (Array.isArray(node)) return node.map(toDraft07);
  if (!isObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) out[key] = toDraft07(value);
  if (out.nullable === true) {
    delete out.nullable;
    if (typeof out.type === 'string') out.type = [out.type, 'null'];
    else if (Array.isArray(out.enum)) out.enum = [...out.enum, null];
  }
  for (const [bool, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (typeof out[bool] === 'boolean') {
      if (out[bool] === true && typeof out[bound] === 'number') {
        out[bool] = out[bound];
        delete out[bound];
      } else {
        delete out[bool];
      }
    }
  }
  return out;
}

export interface SchemaIssue {
  /** JSON pointer into the value, empty for the value itself. */
  path: string;
  message: string;
}

const describe = (e: ErrorObject): SchemaIssue => {
  const extra =
    e.keyword === 'enum'
      ? `: ${(e.params as { allowedValues: unknown[] }).allowedValues.map((v) => JSON.stringify(v)).join(', ')}`
      : e.keyword === 'additionalProperties'
        ? `: ${(e.params as { additionalProperty: string }).additionalProperty}`
        : '';
  return { path: e.instancePath, message: `${e.message ?? 'is invalid'}${extra}` };
};

/** Validates values against the schemas of one OpenAPI document. */
export class SchemaValidator {
  private readonly ajv: Ajv;
  private readonly compiled = new WeakMap<JsonObject, ValidateFunction>();
  private readonly components: Json;

  constructor(
    doc: JsonObject,
    private readonly version: '3.0' | '3.1',
  ) {
    const options = { strict: false, allErrors: true, validateSchema: false, discriminator: false };
    this.ajv = version === '3.1' ? new Ajv2020(options) : new Ajv(options);
    addFormats(this.ajv);
    this.components = version === '3.0' ? toDraft07(doc.components ?? {}) : (doc.components ?? {});
  }

  validate(schema: JsonObject | undefined, value: Json): SchemaIssue[] {
    if (!schema) return [];
    let validate = this.compiled.get(schema);
    if (!validate) {
      // References are to `#/components/...` of the document: the wrapper puts the components at its own root.
      const own = this.version === '3.0' ? toDraft07(schema) : schema;
      try {
        validate = this.ajv.compile({ allOf: [own], components: this.components } as object);
      } catch (e) {
        return [{ path: '', message: `The contract's schema cannot be used: ${(e as Error).message}` }];
      }
      this.compiled.set(schema, validate);
    }
    return validate(value) ? [] : (validate.errors ?? []).map(describe);
  }
}

/** A parameter's text as the schema types it: `5` for an integer, `a,b` for an array. Text that doesn't fit stays text. */
export function coerceParameter(doc: Json, schema: JsonObject | undefined, text: string): Json {
  const s = derefDeep(doc, schema);
  const type = isObject(s) ? (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type) : undefined;
  if ((type === 'integer' || type === 'number') && text.trim() !== '' && !Number.isNaN(Number(text))) return Number(text);
  if (type === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
  if (type === 'array' && isObject(s)) return text.split(',').map((part) => coerceParameter(doc, isObject(s.items) ? s.items : undefined, part.trim()));
  return text;
}
