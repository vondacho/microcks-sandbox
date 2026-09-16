import type { APIRoute } from 'astro';
import { errorResponse, json, microcks } from '../../../lib/microcks/server';

interface UploadRequest {
  artifactName: string;
  content: string;
  mainArtifact: boolean;
}

/** Imports one artifact. Answers with the `name:version` of the service Microcks imported it into. */
export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json()) as Partial<UploadRequest>;
  if (typeof body.artifactName !== 'string' || typeof body.content !== 'string' || typeof body.mainArtifact !== 'boolean') {
    return json({ error: 'Expected {artifactName, content, mainArtifact}' }, 400);
  }
  try {
    return json({ service: await microcks().upload(body.artifactName, body.content, body.mainArtifact) }, 201);
  } catch (e) {
    return errorResponse(e);
  }
};
