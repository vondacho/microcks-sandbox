import type { APIRoute } from 'astro';
import { errorResponse, microcks } from '../../../../lib/microcks/server';

export const DELETE: APIRoute = async ({ params }) => {
  try {
    await microcks().deleteService(params.id!);
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
};
