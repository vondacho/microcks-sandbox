import { useState } from 'react';
import type { Draft, DraftIssue } from '../../lib/design/draft';
import { hasErrors } from '../../lib/design/draft';
import { download, exportPackage } from '../../lib/design/export';
import type { DesignContract } from '../../lib/design/operations';
import { defaultFileName, packageDrafts, type PackagedFile } from '../../lib/design/package';
import { Check } from '../Check';

interface Props {
  designs: DesignContract[];
  drafts: Draft[];
  issues: Map<string, DraftIssue[]>;
  onOpen: (draft: Draft) => void;
}

/** Picks drafts, packages them as one APIExamples file per contract, and downloads the package. */
export function PackagePanel({ designs, drafts, issues, onOpen }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string>();
  const [problem, setProblem] = useState<string>();

  const toggle = (ids: string[], checked: boolean) => {
    setProblem(undefined);
    setPreview(undefined);
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const usable = (d: Draft) => !hasErrors(issues.get(d.id) ?? []);

  const groups = designs
    .map((design) => ({ design, drafts: drafts.filter((d) => d.contractId === design.contract.id) }))
    .filter((g) => g.drafts.length > 0);

  // Only usable drafts count as picked: one that got an error since being ticked drops out of the package.
  const picked = groups
    .map((g) => ({ ...g, drafts: g.drafts.filter((d) => selected.has(d.id) && usable(d)) }))
    .filter((g) => g.drafts.length > 0);

  const build = (): PackagedFile[] | undefined => {
    try {
      setProblem(undefined);
      return picked.map((g) => packageDrafts(g.design, g.drafts, fileNames[g.design.contract.id]?.trim() || defaultFileName(g.design)));
    } catch (e) {
      setProblem((e as Error).message);
      return undefined;
    }
  };

  const count = picked.reduce((n, g) => n + g.drafts.length, 0);

  return (
    <aside className="panel package" aria-label="Package">
      <h2>Package and export</h2>
      {groups.length === 0 ? (
        <p className="muted">Drafts you design show up here, to be packaged as APIExamples files.</p>
      ) : (
        <>
          {groups.map(({ design, drafts: group }) => {
            const id = design.contract.id;
            const fileName = fileNames[id] ?? defaultFileName(design);
            const clash = design.contract.files.find((f) => f.file.name === fileName.trim());
            return (
              <div key={id} className="package-group">
                <div className="row">
                  <Check
                    leaves={group.filter(usable).map((d) => d.id)}
                    selected={selected}
                    onToggle={toggle}
                    label={`Select the drafts of ${id}`}
                  />
                  <strong>{design.contract.service.name}</strong>
                  <span className="version">{design.contract.service.version}</span>
                </div>
                <ul className="rows">
                  {group.map((d) => {
                    const own = issues.get(d.id) ?? [];
                    const errors = own.filter((i) => i.severity === 'error').length;
                    const warnings = own.length - errors;
                    return (
                      <li key={d.id} className="row-item">
                        <Check leaves={usable(d) ? [d.id] : []} selected={selected} onToggle={toggle} label={`Select ${d.name}`} />
                        <button type="button" className="link" onClick={() => onOpen(d)}>
                          {d.name || '(unnamed)'}
                        </button>
                        <code className="muted">{d.operation}</code>
                        {errors > 0 && <span className="badge badge-warn">{errors} to fix</span>}
                        {warnings > 0 && <span className="badge state-live-only">{warnings} warning{warnings === 1 ? '' : 's'}</span>}
                      </li>
                    );
                  })}
                </ul>
                <label className="field">
                  <span className="muted">File name</span>
                  <input value={fileName} onChange={(e) => setFileNames({ ...fileNames, [id]: e.currentTarget.value })} />
                </label>
                {clash && (
                  <p className="muted note-inline">
                    Same name as {clash.file.path}: loaded into Microcks, it replaces that file's examples.
                  </p>
                )}
              </div>
            );
          })}

          <p>
            <strong>{count}</strong> example{count === 1 ? '' : 's'} in{' '}
            {picked.length === 1 ? '1 file' : `${picked.length} files`}
          </p>
          <div className="row">
            <button
              type="button"
              disabled={count === 0}
              onClick={() => {
                const files = build();
                if (!files) return;
                try {
                  download(exportPackage(files));
                } catch (e) {
                  setProblem((e as Error).message);
                }
              }}
            >
              Download{picked.length > 1 ? ' .zip' : ''}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={count === 0}
              onClick={() => {
                const files = build();
                setPreview(preview || !files ? undefined : files.map((f) => `# ${f.fileName}\n${f.content}`).join('\n'));
              }}
            >
              {preview ? 'Hide preview' : 'Preview'}
            </button>
          </div>
          {problem && <p className="error">{problem}</p>}
          {preview && (
            <pre className="package-preview">
              <code>{preview}</code>
            </pre>
          )}
        </>
      )}
    </aside>
  );
}
