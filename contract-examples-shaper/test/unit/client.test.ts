import { describe, expect, it, vi } from 'vitest';
import { MicrocksClient } from '../../src/lib/microcks/client';
import type { JournalRecord } from '../../src/lib/microcks/journal';

type Handler = (url: string, init: RequestInit) => Response;

function fakeFetch(routes: Record<string, Handler>) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!route) throw new TypeError(`fetch failed: ${url}`);
    return routes[route](url, init);
  });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const KEYCLOAK_ON = { enabled: true, realm: 'microcks', 'auth-server-url': 'http://keycloak:8080' };

describe('MicrocksClient', () => {
  it('talks to an unauthenticated Microcks without asking for a token', async () => {
    const fetch = fakeFetch({
      'http://mk/api/keycloak/config': () => json({ enabled: false }),
      'http://mk/api/artifact/upload': (url, init) => {
        expect(url).toContain('mainArtifact=false');
        expect(new Headers(init.headers).has('Authorization')).toBe(false);
        return new Response('Pet Shop API:v1', { status: 201 });
      },
    });
    const client = new MicrocksClient({ url: 'http://mk/', fetch });
    await expect(client.upload('petshop-examples.yaml', 'kind: APIExamples', false)).resolves.toBe('Pet Shop API:v1');
  });

  it('gets a client-credentials token when Keycloak is enabled, and reuses it until it expires', async () => {
    const fetch = fakeFetch({
      'http://mk/api/keycloak/config': () => json(KEYCLOAK_ON),
      'http://kc.local/realms/microcks/protocol/openid-connect/token': (_, init) => {
        expect(new Headers(init.headers).get('Authorization')).toBe(`Basic ${btoa('shaper:s3cret')}`);
        expect(init.body).toBe('grant_type=client_credentials');
        return json({ access_token: 'tok', expires_in: 300 });
      },
      'http://mk/api/services/': (_, init) => {
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
        return new Response(null, { status: 200 });
      },
    });
    const client = new MicrocksClient({
      url: 'http://mk',
      clientId: 'shaper',
      clientSecret: 's3cret',
      keycloakUrl: 'http://kc.local',
      fetch,
    });
    await client.deleteService('a');
    await client.deleteService('b');
    const tokenCalls = fetch.mock.calls.filter(([url]) => String(url).includes('/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('says what is missing when Microcks needs credentials that are not configured', async () => {
    const fetch = fakeFetch({
      'http://mk/api/version/info': () => json({ versionId: '1.14.0' }),
      'http://mk/api/keycloak/config': () => json(KEYCLOAK_ON),
    });
    const client = new MicrocksClient({ url: 'http://mk', fetch });
    await expect(client.status()).resolves.toMatchObject({ reachable: true, authEnabled: true, authMissing: true });
    await expect(client.deleteService('a')).rejects.toThrow(/MICROCKS_CLIENT_ID/);
  });

  it('passes on the reason Microcks rejects an artifact with', async () => {
    const fetch = fakeFetch({
      'http://mk/api/keycloak/config': () => json({ enabled: false }),
      'http://mk/api/artifact/upload': () => new Response('Version property is missing in Collection description', { status: 400 }),
    });
    await expect(new MicrocksClient({ url: 'http://mk', fetch }).upload('c.json', '{}', true)).rejects.toMatchObject({
      status: 400,
      message: 'Version property is missing in Collection description',
    });
  });

  it('journals each call with a command line doing the same, and no credential in it', async () => {
    const calls: JournalRecord[] = [];
    const fetch = fakeFetch({
      'http://mk/api/keycloak/config': () => json(KEYCLOAK_ON),
      'http://kc.local/realms/microcks/protocol/openid-connect/token': () => json({ access_token: 'tok-value', expires_in: 300 }),
      'http://mk/api/artifact/upload': () => new Response('Pet Shop API:v1', { status: 201 }),
      'http://mk/api/services/': () => new Response('Forbidden', { status: 403 }),
    });
    const client = new MicrocksClient({
      url: 'http://mk',
      clientId: 'shaper',
      clientSecret: 's3cret',
      keycloakUrl: 'http://kc.local',
      fetch,
      onCall: (record) => calls.push(record),
    });

    await client.upload('openapi-including-examples.json', '{\n  "openapi": "3.0.0"\n}', true);
    await expect(client.deleteService('svc-1')).rejects.toThrow('Forbidden');

    expect(calls.map(({ method, summary, status, outcome }) => ({ method, summary, status, outcome }))).toEqual([
      { method: 'GET', summary: 'Read the authentication configuration', status: 200, outcome: 'Keycloak enabled' },
      { method: 'POST', summary: 'Get a token from Keycloak for shaper', status: 200, outcome: 'token obtained' },
      { method: 'POST', summary: 'Import openapi-including-examples.json as main artifact', status: 201, outcome: 'imported into Pet Shop API:v1' },
      { method: 'DELETE', summary: 'Delete service svc-1', status: 403, outcome: 'Forbidden' },
    ]);
    expect(calls[2].command).toContain(`-F 'file=@-;filename="openapi-including-examples.json"'`);
    expect(calls[3].command).toBe(`curl -sS -X DELETE -H "Authorization: Bearer $MICROCKS_TOKEN" 'http://mk/api/services/svc-1'`);
    for (const { command } of calls) {
      expect(command).not.toMatch(/s3cret|tok-value/);
    }
  });

  it('journals a Microcks it cannot reach', async () => {
    const calls: JournalRecord[] = [];
    await new MicrocksClient({ url: 'http://nowhere', fetch: fakeFetch({}), onCall: (r) => calls.push(r) }).status();
    expect(calls).toMatchObject([{ status: 0, summary: 'Read the Microcks version', outcome: expect.stringMatching(/Cannot reach/) }]);
  });

  it('reports an unreachable Microcks as such', async () => {
    const status = await new MicrocksClient({ url: 'http://nowhere', fetch: fakeFetch({}) }).status();
    expect(status).toMatchObject({ reachable: false, error: expect.stringMatching(/Cannot reach Microcks/) });
  });
});
