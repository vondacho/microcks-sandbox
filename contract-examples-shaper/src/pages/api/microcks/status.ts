import type { APIRoute } from 'astro';
import { json, microcks } from '../../../lib/microcks/server';

export const GET: APIRoute = async () => json(await microcks().status());
