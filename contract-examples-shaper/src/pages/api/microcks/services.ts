import type { APIRoute } from 'astro';
import { errorResponse, json, microcks } from '../../../lib/microcks/server';

/** Every service with the examples it holds and the artifact each came from. */
export const GET: APIRoute = async () => {
  try {
    return json(await microcks().liveState());
  } catch (e) {
    return errorResponse(e);
  }
};
