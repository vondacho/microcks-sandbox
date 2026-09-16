import type { APIRoute } from 'astro';
import type { FetchResult } from '../../../lib/api';
import type { SourceFile } from '../../../lib/artifacts/types';
import { json } from '../../../lib/microcks/server';
import { MAX_FILE_BYTES as MAX_BYTES, nameOfUrl } from '../../../lib/sources';

const TIMEOUT_MS = 15_000;

async function fetchOne(raw: string): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { url: raw, error: 'Not a URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { url: raw, error: 'Only http and https URLs are fetched' };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
    if (!response.ok) return { url: raw, error: `HTTP ${response.status}` };
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) return { url: raw, error: 'Larger than 5 MB' };
    const content = await response.text();
    if (content.length > MAX_BYTES) return { url: raw, error: 'Larger than 5 MB' };
    return { url: raw, file: { path: raw, name: nameOfUrl(url), content, origin: 'url' } };
  } catch (e) {
    return { url: raw, error: (e as Error).message };
  }
}

/** Fetched here rather than in the browser, which most raw file hosts would refuse through CORS. */
export const POST: APIRoute = async ({ request }) => {
  const { urls } = (await request.json()) as { urls?: unknown };
  if (!Array.isArray(urls) || !urls.every((u) => typeof u === 'string')) return json({ error: 'Expected {urls: string[]}' }, 400);
  return json(await Promise.all(urls.map(fetchOne)));
};
