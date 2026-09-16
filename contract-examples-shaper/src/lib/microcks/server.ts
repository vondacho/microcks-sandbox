import { MicrocksClient, MicrocksError } from './client';
import { Journal } from './journal';

const env = (name: string): string | undefined => process.env[name] || import.meta.env[name] || undefined;

let client: MicrocksClient | undefined;

/** Every call the client below makes, for the console. */
export const journal = new Journal();

/** One client per server process, so that its Keycloak token is reused across requests. */
export function microcks(): MicrocksClient {
  client ??= new MicrocksClient({
    onCall: (record) => journal.record(record),
    url: env('MICROCKS_URL') ?? 'http://localhost:8585',
    clientId: env('MICROCKS_CLIENT_ID'),
    clientSecret: env('MICROCKS_CLIENT_SECRET'),
    keycloakUrl: env('MICROCKS_KEYCLOAK_URL'),
  });
  return client;
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Microcks' own refusals keep their status; not reaching it at all is a bad gateway. */
export function errorResponse(e: unknown): Response {
  const status = e instanceof MicrocksError ? (e.status === 0 ? 502 : e.status) : 500;
  return json({ error: (e as Error).message }, status);
}
