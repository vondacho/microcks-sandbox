import { previewFromMicrocks, type ExchangePreview } from '../preview';
import type { MicrocksPort } from '../runner';
import { requestCommand, tokenCommand, uploadCommand } from './curl';
import type { JournalRecord } from './journal';
import { exchangeIdentity, toLiveService, type LiveState } from './live-state';

export interface MicrocksConfig {
  /** Base URL of Microcks, e.g. http://localhost:8585 */
  url: string;
  /** A Keycloak service account allowed to import (role `manager`) and delete (`admin` or `manager`). */
  clientId?: string;
  clientSecret?: string;
  /** Overrides the Keycloak URL Microcks advertises, which is often only reachable from inside its network. */
  keycloakUrl?: string;
  fetch?: typeof fetch;
  /** Told about every call made to Microcks or Keycloak once it has an answer, or has failed to get one. */
  onCall?: (record: JournalRecord) => void;
}

export interface MicrocksStatus {
  url: string;
  reachable: boolean;
  version?: string;
  authEnabled?: boolean;
  /** Set when authentication is enabled but no credentials are configured. */
  authMissing?: boolean;
  error?: string;
}

/** An error Microcks answered with, or a failure to reach it. `status` 0 means no answer. */
export class MicrocksError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface CallOptions extends RequestInit {
  /** Whether to send the Keycloak token, when Microcks wants one. */
  auth?: boolean;
  /** What the call is for, for the journal. */
  summary: string;
  /** The command line doing the same call, when a plain `curl` of the URL is not enough. */
  command?: (authenticated: boolean) => string;
  /** Describes a successful answer for the journal. Given a copy of the response, so the caller can still read it. */
  outcome?: (response: Response) => Promise<string | undefined>;
}

interface KeycloakConfig {
  enabled: boolean;
  realm?: string;
  'auth-server-url'?: string;
}

const EXPIRY_MARGIN_MS = 30_000;

/** Server side only: holds the client secret. The Microcks CLI authenticates the same way. */
export class MicrocksClient implements MicrocksPort {
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private keycloak?: Promise<KeycloakConfig>;
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: MicrocksConfig) {
    this.base = config.url.replace(/\/+$/, '');
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async status(): Promise<MicrocksStatus> {
    const url = this.base;
    try {
      const version = (await this.json('/api/version/info', { auth: false, summary: 'Read the Microcks version' })) as {
        versionId?: string;
      };
      const keycloak = await this.keycloakConfig();
      const authMissing = keycloak.enabled && !(this.config.clientId && this.config.clientSecret);
      return { url, reachable: true, version: version.versionId, authEnabled: keycloak.enabled, authMissing };
    } catch (e) {
      return { url, reachable: false, error: (e as Error).message };
    }
  }

  async liveState(): Promise<LiveState> {
    const list = (await this.json('/api/services?page=0&size=1000', {
      summary: 'List services',
      outcome: async (r) => {
        const count = ((await r.json()) as unknown[]).length;
        return `${count} service${count === 1 ? '' : 's'}`;
      },
    })) as { id: string; name: string; version: string }[];
    const services = await Promise.all(
      list.map(async ({ id, name, version }) =>
        toLiveService(
          await this.json(`/api/services/${encodeURIComponent(id)}?messages=true`, {
            summary: `Read ${name}:${version} with its examples`,
          }),
        ),
      ),
    );
    return { services };
  }

  /** One example as Microcks holds and serves it, or undefined when it holds no such example. */
  async exchange(serviceId: string, operation: string, example: string, sourceArtifact: string): Promise<ExchangePreview | undefined> {
    const body = (await this.json(`/api/services/${encodeURIComponent(serviceId)}?messages=true`, {
      summary: `Read example ${example} of ${operation}`,
    })) as { messagesMap?: Record<string, unknown[]> };
    const found = (body.messagesMap?.[operation] ?? []).find((raw) => {
      const identity = exchangeIdentity(raw);
      return identity.example === example && identity.sourceArtifact === sourceArtifact;
    });
    return found === undefined ? undefined : previewFromMicrocks(operation, found);
  }

  async upload(artifactName: string, content: string, mainArtifact: boolean): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'application/octet-stream' }), artifactName);
    const path = `/api/artifact/upload?mainArtifact=${mainArtifact}`;
    const response = await this.request(path, {
      method: 'POST',
      body: form,
      summary: `Import ${artifactName} as ${mainArtifact ? 'main' : 'secondary'} artifact`,
      command: (authenticated) => uploadCommand(this.base + path, artifactName, content, authenticated),
      outcome: async (r) => (r.status === 201 ? `imported into ${(await r.text()).trim()}` : 'no file in the upload'),
    });
    const body = (await response.text()).trim();
    if (response.status === 201) return body;
    // 204 means the upload held no file; anything else carries Microcks' reason.
    throw new MicrocksError(response.status, body || `Microcks did not import ${artifactName} (HTTP ${response.status})`);
  }

  async deleteService(serviceId: string): Promise<void> {
    await this.request(`/api/services/${encodeURIComponent(serviceId)}`, { method: 'DELETE', summary: `Delete service ${serviceId}` });
  }

  private keycloakConfig(): Promise<KeycloakConfig> {
    this.keycloak ??= (
      this.json('/api/keycloak/config', {
        auth: false,
        summary: 'Read the authentication configuration',
        outcome: async (r) => (((await r.json()) as KeycloakConfig).enabled ? 'Keycloak enabled' : 'no authentication'),
      }) as Promise<KeycloakConfig>
    ).catch((e) => {
      this.keycloak = undefined;
      throw e;
    });
    return this.keycloak;
  }

  private async bearer(): Promise<string | undefined> {
    const keycloak = await this.keycloakConfig();
    if (!keycloak.enabled) return undefined;
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;

    const { clientId, clientSecret } = this.config;
    if (!clientId || !clientSecret) {
      throw new MicrocksError(401, 'Microcks requires authentication: set MICROCKS_CLIENT_ID and MICROCKS_CLIENT_SECRET.');
    }
    const server = (this.config.keycloakUrl ?? keycloak['auth-server-url'] ?? '').replace(/\/+$/, '');
    const tokenUrl = `${server}/realms/${keycloak.realm}/protocol/openid-connect/token`;
    const journal = (status: number, outcome: string) =>
      this.config.onCall?.({
        at: new Date(started).toISOString(),
        method: 'POST',
        url: tokenUrl,
        summary: `Get a token from Keycloak for ${clientId}`,
        command: tokenCommand(tokenUrl),
        status,
        durationMs: Date.now() - started,
        outcome,
      });
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetch(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
    } catch (e) {
      const error = new MicrocksError(0, `Cannot reach Keycloak at ${tokenUrl}: ${(e as Error).message}`);
      journal(0, error.message);
      throw error;
    }
    if (!response.ok) {
      const error = new MicrocksError(response.status, `Keycloak refused the client credentials (HTTP ${response.status})`);
      journal(response.status, error.message);
      throw error;
    }
    journal(response.status, 'token obtained');
    const { access_token, expires_in } = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: access_token, expiresAt: Date.now() + expires_in * 1000 - EXPIRY_MARGIN_MS };
    return access_token;
  }

  private async request(path: string, init: CallOptions): Promise<Response> {
    const { auth = true, summary, command, outcome, ...rest } = init;
    const headers = new Headers(rest.headers);
    const token = auth ? await this.bearer() : undefined;
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const url = this.base + path;
    const method = rest.method ?? 'GET';
    const started = Date.now();
    const journal = (status: number, text?: string) =>
      this.config.onCall?.({
        at: new Date(started).toISOString(),
        method,
        url,
        summary,
        command: command ? command(Boolean(token)) : requestCommand(method, url, Boolean(token)),
        status,
        durationMs: Date.now() - started,
        outcome: text,
      });

    let response: Response;
    try {
      response = await this.fetch(url, { ...rest, headers });
    } catch (e) {
      const error = new MicrocksError(0, `Cannot reach Microcks at ${this.base}: ${(e as Error).message}`);
      journal(0, error.message);
      throw error;
    }
    if (response.status === 401 && token) this.token = undefined;
    if (response.status >= 400) {
      const text = (await response.text()).trim();
      const error = new MicrocksError(response.status, text || `Microcks answered HTTP ${response.status} to ${method} ${path}`);
      journal(response.status, error.message);
      throw error;
    }
    journal(response.status, this.config.onCall && outcome ? await outcome(response.clone()).catch(() => undefined) : undefined);
    return response;
  }

  private async json(path: string, init: CallOptions): Promise<unknown> {
    return (await this.request(path, init)).json();
  }
}
