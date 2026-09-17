import type { SourceFile } from './artifacts/types';
import type { LiveState } from './microcks/live-state';
import type { MicrocksStatus } from './microcks/client';
import type { JournalPage } from './microcks/journal';
import type { ExchangePreview } from './preview';
import type { MicrocksPort } from './runner';

/** The browser's way to Microcks: through this app's API routes, which hold the credentials. */

const settledListeners = new Set<() => void>();

/**
 * Called each time a call to the API routes has settled, whether it succeeded or not: the moment the server's
 * journal may hold new entries. Returns the unsubscribe function.
 */
export function onCallSettled(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(path, init);
    const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);
    if (!response.ok) throw new Error((body as { error?: string })?.error ?? `HTTP ${response.status}`);
    return body as T;
  } finally {
    settledListeners.forEach((listener) => listener());
  }
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getStatus = () => call<MicrocksStatus>('/api/microcks/status');

export const getLiveState = () => call<LiveState>('/api/microcks/services');

export const getExchange = (serviceId: string, operation: string, example: string, artifact: string) =>
  call<ExchangePreview>(
    `/api/microcks/services/${encodeURIComponent(serviceId)}/exchange?${new URLSearchParams({ operation, example, artifact })}`,
  );

export type FetchResult = { url: string; file: SourceFile } | { url: string; error: string };

export const fetchUrls = (urls: string[]) => call<FetchResult[]>('/api/sources/fetch', post({ urls }));

// Reading or clearing the journal makes no call to Microcks, so these don't notify the listeners above.
export async function getJournal(after: number): Promise<JournalPage> {
  const response = await fetch(`/api/journal?after=${after}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function clearJournal(): Promise<void> {
  await fetch('/api/journal', { method: 'DELETE' });
}

export const microcksPort: MicrocksPort = {
  async upload(artifactName, content, mainArtifact) {
    return (await call<{ service: string }>('/api/microcks/artifacts', post({ artifactName, content, mainArtifact }))).service;
  },
  async deleteService(serviceId) {
    await call<void>(`/api/microcks/services/${encodeURIComponent(serviceId)}`, { method: 'DELETE' });
  },
};
