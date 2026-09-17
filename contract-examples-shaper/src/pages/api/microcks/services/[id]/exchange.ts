import type { APIRoute } from 'astro';
import { errorResponse, json, microcks } from '../../../../../lib/microcks/server';

/** `?operation=&example=&artifact=`: one example as Microcks serves it. */
export const GET: APIRoute = async ({ params, url }) => {
  const [operation, example, artifact] = ['operation', 'example', 'artifact'].map((k) => url.searchParams.get(k));
  if (!operation || !example || !artifact) return json({ error: 'Expected ?operation=&example=&artifact=' }, 400);
  try {
    const exchange = await microcks().exchange(params.id!, operation, example, artifact);
    return exchange ? json(exchange) : json({ error: `Microcks holds no example ${example} of ${operation} from ${artifact}.` }, 404);
  } catch (e) {
    return errorResponse(e);
  }
};
