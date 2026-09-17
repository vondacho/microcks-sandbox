import { strToU8, zipSync } from 'fflate';
import type { PackagedFile } from './package';

export interface ExportFile {
  fileName: string;
  type: string;
  data: Uint8Array;
}

/** One package file downloads as itself; several come in a zip, one YAML per contract. */
export function exportPackage(files: PackagedFile[], now = new Date()): ExportFile {
  if (files.length === 0) throw new Error('Nothing to export.');
  if (files.length === 1) {
    return { fileName: files[0].fileName, type: 'application/yaml', data: strToU8(files[0].content) };
  }
  const names = new Set<string>();
  for (const f of files) {
    if (names.has(f.fileName)) throw new Error(`Two contracts would be exported as ${f.fileName}: rename one.`);
    names.add(f.fileName);
  }
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return {
    fileName: `api-examples-${stamp}.zip`,
    type: 'application/zip',
    data: zipSync(Object.fromEntries(files.map((f) => [f.fileName, strToU8(f.content)]))),
  };
}

/** Hands a file to the browser to save. */
export function download(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.data as BlobPart], { type: file.type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
