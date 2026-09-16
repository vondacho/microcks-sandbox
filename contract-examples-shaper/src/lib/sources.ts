import type { SourceFile } from './artifacts/types';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ARTIFACT_EXTENSIONS = /\.(json|ya?ml|graphql|gql|proto|xml|har)$/i;
const SKIPPED_DIRECTORIES = /(^|\/)(node_modules|target|dist|build)\/|(^|\/)\.[^/]+\//;

/** The artifact name for a URL: its last path segment, as a file picked from a folder would be named. */
export function nameOfUrl(url: URL): string {
  const segment = url.pathname.split('/').filter(Boolean).pop();
  return segment ? decodeURIComponent(segment) : url.hostname;
}

/** Reads the files of a picked folder that could be artifacts; build output and dot-directories are skipped. */
export async function readPickedFiles(files: Iterable<File>): Promise<{ files: SourceFile[]; skipped: string[] }> {
  const result: SourceFile[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (!ARTIFACT_EXTENSIONS.test(file.name) || SKIPPED_DIRECTORIES.test(path)) continue;
    if (file.size > MAX_FILE_BYTES) {
      skipped.push(`${path}: larger than 5 MB`);
      continue;
    }
    result.push({ path, name: file.name, content: await file.text(), origin: 'folder' });
  }
  return { files: result, skipped };
}

/** Adds files to a set of sources; a file picked again replaces the earlier copy. */
export function mergeSources(current: SourceFile[], added: SourceFile[]): SourceFile[] {
  const byPath = new Map(current.map((f) => [f.path, f]));
  added.forEach((f) => byPath.set(f.path, f));
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
