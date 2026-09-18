import { useState } from 'react';
import type { SourceFile } from '../lib/artifacts/types';
import { fetchUrls } from '../lib/api';
import { readPickedFiles } from '../lib/sources';

interface Props {
  count: number;
  onAdd: (files: SourceFile[]) => void;
  onClear: () => void;
}

export function SourcePicker({ count, onAdd, onClear }: Props) {
  const [urls, setUrls] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const pick = async (list: FileList | null, folder: boolean) => {
    if (!list) return;
    setBusy(true);
    const { files, skipped } = await readPickedFiles(Array.from(list), { folder });
    setProblems(skipped);
    onAdd(files);
    setBusy(false);
  };

  const fetchAll = async () => {
    const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
    if (list.length === 0) return;
    setBusy(true);
    try {
      const results = await fetchUrls(list);
      onAdd(results.flatMap((r) => ('file' in r ? [r.file] : [])));
      setProblems(results.flatMap((r) => ('error' in r ? [`${r.url}: ${r.error}`] : [])));
      setUrls(results.filter((r) => 'error' in r).map((r) => r.url).join('\n'));
    } catch (e) {
      setProblems([(e as Error).message]);
    }
    setBusy(false);
  };

  return (
    <section className="panel sources" aria-label="Sources">
      <div className="source">
        <h2>From a folder</h2>
        <p className="muted">
          Read in your browser: the YAML and JSON files of the folder and its subfolders, skipping build output and
          dot-folders.
        </p>
        <div className="row">
          <label className="button">
            Choose folder…
            {/* @ts-expect-error webkitdirectory is not in React's input attributes */}
            <input type="file" webkitdirectory="" multiple hidden onChange={(e) => pick(e.currentTarget.files, true)} />
          </label>
          <label className="button secondary">
            Choose files…
            <input type="file" multiple hidden onChange={(e) => pick(e.currentTarget.files, false)} />
          </label>
        </div>
      </div>
      <div className="source">
        <h2>From URLs</h2>
        <p className="muted">Raw file URLs, one per line. The artifact name is the last part of the path.</p>
        <textarea
          rows={3}
          value={urls}
          placeholder="https://raw.githubusercontent.com/microcks/microcks/master/samples/APIPastry-openapi.yaml"
          onChange={(e) => setUrls(e.currentTarget.value)}
        />
        <div className="row">
          <button type="button" onClick={fetchAll} disabled={busy || !urls.trim()}>
            Fetch
          </button>
        </div>
      </div>
      <div className="source summary">
        <p>
          <strong>{count}</strong> file{count === 1 ? '' : 's'} read {busy && <span className="muted">· reading…</span>}
        </p>
        {count > 0 && (
          <button type="button" className="secondary" onClick={onClear}>
            Clear sources
          </button>
        )}
        {problems.length > 0 && (
          <ul className="problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
