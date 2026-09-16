/** What Microcks currently holds, reduced to what the shaper compares its sources against. */
export interface LiveMessage {
  operation: string;
  example: string;
  /** The artifact name (upload filename, or download URL) the message was imported from. */
  sourceArtifact: string;
}

export interface LiveService {
  /** Microcks' own id, needed to delete the service. */
  id: string;
  name: string;
  version: string;
  type: string;
  /** The main artifact the service was last imported from. */
  sourceArtifact?: string;
  messages: LiveMessage[];
}

export interface LiveState {
  services: LiveService[];
}

type Raw = Record<string, unknown>;
const record = (v: unknown): Raw => (typeof v === 'object' && v !== null ? (v as Raw) : {});
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Reads `GET /api/services/{id}?messages=true`. Each operation maps to exchanges shaped by service type:
 * `{name, request, response}` for request/response pairs, `{eventMessage}` for events.
 */
export function toLiveService(raw: unknown): LiveService {
  const body = record(raw);
  const service = record(body.service);
  const messages: LiveMessage[] = [];
  for (const [operation, exchanges] of Object.entries(record(body.messagesMap))) {
    for (const exchange of Array.isArray(exchanges) ? exchanges : []) {
      const e = record(exchange);
      const parts = [record(e.response), record(e.request), record(e.eventMessage), record(e.reply)];
      const example = text(e.name) ?? parts.map((p) => text(p.name)).find(Boolean);
      const sourceArtifact = parts.map((p) => text(p.sourceArtifact)).find(Boolean);
      if (example && sourceArtifact) messages.push({ operation, example, sourceArtifact });
    }
  }
  return {
    id: String(service.id),
    name: String(service.name),
    version: String(service.version),
    type: String(service.type ?? ''),
    sourceArtifact: text(service.sourceArtifact),
    messages,
  };
}

export const liveServiceId = (s: LiveService): string => `${s.name}:${s.version}`;
