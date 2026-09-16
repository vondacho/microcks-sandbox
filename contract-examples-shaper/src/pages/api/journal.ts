import type { APIRoute } from 'astro';
import { journal, json } from '../../lib/microcks/server';

/** Calls made to Microcks since `after` (a `seq`), oldest first. */
export const GET: APIRoute = ({ url }) => json(journal.since(Number(url.searchParams.get('after') ?? 0) || 0));

export const DELETE: APIRoute = () => {
  journal.clear();
  return new Response(null, { status: 204 });
};
