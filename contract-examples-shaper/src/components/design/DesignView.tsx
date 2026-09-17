import { useMemo, useState } from 'react';
import type { Catalog } from '../../lib/artifacts/catalog';
import type { SourceFile } from '../../lib/artifacts/types';
import { draftIssues, duplicateDraft, freshName, newDraft, type Draft, type DraftIssue } from '../../lib/design/draft';
import { designContract, isDesignable, type DesignContract, type DesignOperation } from '../../lib/design/operations';
import type { PackagedFile } from '../../lib/design/package';
import { SchemaValidator } from '../../lib/design/schema';
import { DraftEditor } from './DraftEditor';
import { PackagePanel } from './PackagePanel';
import { useDrafts, type SaveState } from './useDrafts';

interface Props {
  catalog: Catalog;
  onAddToSources: (files: PackagedFile[], designs: DesignContract[]) => SourceFile[];
}

interface Target {
  contractId: string;
  operation: string;
}

const SAVE_LABELS: Record<SaveState, string> = {
  loading: 'Opening drafts…',
  saving: 'Saving…',
  saved: 'Drafts saved in this browser',
  failed: 'Saving failed',
};

/**
 * Examples the sources already hold for an operation, by name. Packages added from here don't count: they hold the
 * drafts themselves, which would otherwise all clash with their own copy.
 */
const existingExamples = (design: DesignContract, operation: string): string[] => {
  const designed = new Set(design.contract.files.filter((f) => f.file.origin === 'package').map((f) => f.file.path));
  return (design.contract.operations.find((o) => o.name === operation)?.examples ?? []).filter((e) => !designed.has(e.path)).map((e) => e.example);
};

export function DesignView({ catalog, onAddToSources }: Props) {
  const { drafts, state, persistent, save, remove } = useDrafts();
  const [target, setTarget] = useState<Target>();
  const [openId, setOpenId] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState<string>();

  const results = useMemo(() => catalog.contracts.map(designContract), [catalog]);
  const designs = useMemo(() => results.filter(isDesignable), [results]);
  const validators = useMemo(() => new Map(designs.map((d) => [d.contract.id, new SchemaValidator(d.document, d.openapi)])), [designs]);

  const issues = useMemo(() => {
    const map = new Map<string, DraftIssue[]>();
    for (const draft of drafts) {
      const design = designs.find((d) => d.contract.id === draft.contractId);
      if (!design) continue;
      map.set(
        draft.id,
        draftIssues(draft, design.operations.find((o) => o.name === draft.operation), {
          design,
          validator: validators.get(design.contract.id)!,
          siblings: drafts.filter((d) => d.contractId === draft.contractId && d.operation === draft.operation),
          existing: existingExamples(design, draft.operation),
        }),
      );
    }
    return map;
  }, [drafts, designs, validators]);

  const design = designs.find((d) => d.contract.id === target?.contractId);
  const op = design?.operations.find((o) => o.name === target?.operation);
  const opDrafts = drafts.filter((d) => d.contractId === target?.contractId && d.operation === target?.operation);
  const open = opDrafts.find((d) => d.id === openId);
  const orphans = drafts.filter((d) => !designs.some((x) => x.contract.id === d.contractId));

  const select = (contractId: string, operation: string, draftId?: string) => {
    setTarget({ contractId, operation });
    setOpenId(draftId ?? drafts.find((d) => d.contractId === contractId && d.operation === operation)?.id);
    setConfirmDelete(undefined);
  };

  const create = (design: DesignContract, op: DesignOperation, from?: Draft) => {
    const taken = [...opDrafts.map((d) => d.name), ...existingExamples(design, op.name)];
    const draft = from ? duplicateDraft(from, freshName(`${from.name}_copy`, taken)) : newDraft(design, op, freshName('example', taken));
    save(draft, { immediately: true });
    setOpenId(draft.id);
  };

  return (
    <div className="design">
      <nav className="panel operations" aria-label="Operations">
        <h2>Operations</h2>
        {results.length === 0 && <p className="muted">Choose a folder or fetch URLs holding an OpenAPI contract to design examples for it.</p>}
        {results.map((result) =>
          isDesignable(result) ? (
            <div key={result.contract.id} className="design-contract">
              <div className="row">
                <strong>{result.contract.service.name}</strong>
                <span className="version">{result.contract.service.version}</span>
              </div>
              <ul className="rows">
                {result.operations.map((o) => {
                  const own = drafts.filter((d) => d.contractId === result.contract.id && d.operation === o.name).length;
                  const inSources = existingExamples(result, o.name).length;
                  const current = target?.contractId === result.contract.id && target.operation === o.name;
                  return (
                    <li key={o.name}>
                      <button
                        type="button"
                        className={`operation-button${current ? ' active' : ''}`}
                        aria-current={current}
                        onClick={() => select(result.contract.id, o.name)}
                      >
                        <span className={`method method-${o.method.toLowerCase()}`}>{o.method}</span>
                        <code>{o.path}</code>
                        <span className="muted counts-inline">
                          {own > 0 && `${own} draft${own === 1 ? '' : 's'}`}
                          {own > 0 && inSources > 0 && ' · '}
                          {inSources > 0 && `${inSources} in sources`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div key={result.contract.id} className="design-contract muted">
              <div className="row">
                <strong>{result.contract.service.name}</strong>
                <span className="version">{result.contract.service.version}</span>
              </div>
              <p className="note-inline">{result.reason}</p>
            </div>
          ),
        )}
        {orphans.length > 0 && (
          <div className="design-contract">
            <p className="muted note-inline">
              {orphans.length} draft{orphans.length === 1 ? '' : 's'} for contracts not in the sources (
              {[...new Set(orphans.map((d) => d.contractId))].join(', ')}): add their contract to edit or package them.
            </p>
          </div>
        )}
      </nav>

      <section className="panel workbench" aria-label="Examples">
        <div className="workbench-bar">
          <h2>{op ? <code>{op.name}</code> : 'Examples'}</h2>
          <span className={`muted save-state save-${state}`} role="status">
            {persistent ? SAVE_LABELS[state] : 'This browser keeps no drafts: they last until the page is closed'}
          </span>
        </div>
        {!design || !op ? (
          <p className="muted empty">Pick an operation to design examples for it.</p>
        ) : (
          <>
            {op.summary && <p className="muted">{op.summary}</p>}
            <div className="draft-tabs">
              {existingExamples(design, op.name).length > 0 && (
                <p className="muted note-inline">In the sources: {existingExamples(design, op.name).join(', ')}</p>
              )}
              <div className="row">
                {opDrafts.map((d) => {
                  const errors = (issues.get(d.id) ?? []).some((i) => i.severity === 'error');
                  return (
                    <button
                      key={d.id}
                      type="button"
                      className={`draft-tab${d.id === open?.id ? ' active' : ''}${errors ? ' has-errors' : ''}`}
                      aria-pressed={d.id === open?.id}
                      onClick={() => setOpenId(d.id)}
                    >
                      {d.name || '(unnamed)'}
                    </button>
                  );
                })}
                <button type="button" className="secondary small" onClick={() => create(design, op)}>
                  + New example
                </button>
                {open && (
                  <>
                    <button type="button" className="secondary small" onClick={() => create(design, op, open)}>
                      Duplicate
                    </button>
                    {confirmDelete === open.id ? (
                      <button
                        type="button"
                        className="danger small"
                        onClick={() => {
                          void remove(open.id);
                          setOpenId(opDrafts.find((d) => d.id !== open.id)?.id);
                          setConfirmDelete(undefined);
                        }}
                      >
                        Delete {open.name || 'draft'}?
                      </button>
                    ) : (
                      <button type="button" className="danger small" onClick={() => setConfirmDelete(open.id)}>
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {open ? (
              <DraftEditor design={design} op={op} draft={open} issues={issues.get(open.id) ?? []} onChange={(d) => save(d)} />
            ) : (
              <p className="muted empty">No draft for this operation yet: start one with + New example.</p>
            )}
          </>
        )}
      </section>

      <PackagePanel
        designs={designs}
        drafts={drafts}
        issues={issues}
        onOpen={(d) => select(d.contractId, d.operation, d.id)}
        onAddToSources={(files) => onAddToSources(files, designs)}
      />
    </div>
  );
}
