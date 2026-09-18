import { describe, expect, it } from 'vitest';
import { mergeSources, nameOfUrl, readPickedFiles } from '../../src/lib/sources';

/** A picked file, as the browser hands it over: a folder pick carries the path it was found at. */
const picked = (path: string, content = '{}', size = content.length): File =>
  ({ name: path.split('/').pop()!, size, webkitRelativePath: path.includes('/') ? path : '', text: async () => content }) as unknown as File;

describe('readPickedFiles', () => {
  const names = ['api/petshop.openapi.json', 'api/examples.yaml', 'api/legacy.yml', 'api/v1/openapi.json'];
  const others = ['api/films.graphql', 'api/pets.proto', 'api/soapui-project.xml', 'api/capture.har', 'api/README.md'];

  it('keeps the YAML and JSON of a folder, and nothing else', async () => {
    const { files } = await readPickedFiles([...names, ...others].map((p) => picked(p)));
    expect(files.map((f) => f.path)).toEqual(names);
    expect(files.every((f) => f.origin === 'folder')).toBe(true);
  });

  it('keeps every format Microcks reads when files are picked by hand', async () => {
    const { files } = await readPickedFiles([...names, ...others].map((p) => picked(p)), { folder: false });
    expect(files.map((f) => f.name)).toEqual([...names, ...others].map((p) => p.split('/').pop()).filter((n) => n !== 'README.md'));
  });

  it('skips build output, dot-folders and anything too large', async () => {
    const { files, skipped } = await readPickedFiles([
      picked('api/node_modules/pkg/openapi.json'),
      picked('api/.git/config.json'),
      picked('api/dist/openapi.json'),
      picked('api/huge.json', '{}', 6 * 1024 * 1024),
      picked('api/openapi.json'),
    ]);
    expect(files.map((f) => f.path)).toEqual(['api/openapi.json']);
    expect(skipped).toEqual(['api/huge.json: larger than 5 MB']);
  });
});

describe('sources', () => {
  it('names a URL after the last segment of its path', () => {
    expect(nameOfUrl(new URL('https://raw.example.com/org/repo/main/api/petshop.openapi.json'))).toBe('petshop.openapi.json');
    expect(nameOfUrl(new URL('https://example.com/'))).toBe('example.com');
  });

  it('replaces a file picked again, and keeps the sources sorted by path', () => {
    const first = { path: 'a/openapi.json', name: 'openapi.json', content: 'one', origin: 'folder' as const };
    const merged = mergeSources([{ path: 'b/examples.yaml', name: 'examples.yaml', content: '', origin: 'folder' as const }, first], [
      { ...first, content: 'two' },
    ]);
    expect(merged.map((f) => `${f.path}:${f.content}`)).toEqual(['a/openapi.json:two', 'b/examples.yaml:']);
  });
});
