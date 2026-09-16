import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCatalog } from '../lib/artifacts/catalog';
import type { SourceFile } from '../lib/artifacts/types';
import { getLiveState, getStatus, microcksPort } from '../lib/api';
import type { MicrocksStatus as Status } from '../lib/microcks/client';
import type { LiveState } from '../lib/microcks/live-state';
import { buildPlan, mergeApplied, type Mode, type Plan } from '../lib/plan';
import { runPlan, type StepOutcome } from '../lib/runner';
import { mergeSources } from '../lib/sources';
import { CatalogTree } from './CatalogTree';
import { Console } from './Console';
import { MicrocksStatus } from './MicrocksStatus';
import { PlanPanel } from './PlanPanel';
import { SourcePicker } from './SourcePicker';

/** Files without a trace in Microcks that were applied (see `appliedKey`). The key predates the name. */
const APPLIED_FILES_KEY = 'contract-examples-shaper.applied-metadata';

function loadApplied(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(APPLIED_FILES_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveApplied(applied: Set<string>) {
  try {
    localStorage.setItem(APPLIED_FILES_KEY, JSON.stringify([...applied]));
  } catch {
    // Remembering applied metadata is a convenience; without storage it lasts until the page is reloaded.
  }
}

export default function App() {
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [status, setStatus] = useState<Status>();
  const [live, setLive] = useState<LiveState>({ services: [] });
  const [liveError, setLiveError] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Set<string>>(() => loadApplied());
  const [plan, setPlan] = useState<{ mode: Mode; plan: Plan }>();
  const [outcomes, setOutcomes] = useState<StepOutcome[]>([]);
  const [running, setRunning] = useState(false);

  const catalog = useMemo(() => buildCatalog(sources), [sources]);

  const refresh = useCallback(async () => {
    const next = await getStatus();
    setStatus(next);
    if (!next.reachable) return;
    try {
      setLive(await getLiveState());
      setLiveError(undefined);
    } catch (e) {
      setLiveError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback((leaves: string[], checked: boolean) => {
    setPlan(undefined);
    setSelected((current) => {
      const next = new Set(current);
      leaves.forEach((leaf) => (checked ? next.add(leaf) : next.delete(leaf)));
      return next;
    });
  }, []);

  const preview = (mode: Mode) => {
    try {
      setPlan({ mode, plan: buildPlan({ catalog, live, selected, mode, appliedFiles: applied }) });
      setOutcomes([]);
    } catch (e) {
      setPlan({ mode, plan: { steps: [{ type: 'blocked', contractId: '', reason: (e as Error).message }], appliedFiles: {} } });
    }
  };

  const apply = async () => {
    if (!plan) return;
    setRunning(true);
    setOutcomes(plan.plan.steps.map(() => ({ status: 'pending' })));
    const succeeded = await runPlan(plan.plan, microcksPort, (index, outcome) =>
      setOutcomes((current) => current.map((o, i) => (i === index ? outcome : o))),
    );

    const nextApplied = mergeApplied(applied, plan.plan, succeeded);
    setApplied(nextApplied);
    saveApplied(nextApplied);

    await refresh();
    setSelected(new Set());
    setRunning(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Contract Examples Shaper</h1>
          <p className="muted">Pick contracts, examples and metadata, then load them into Microcks or take them out.</p>
        </div>
        <MicrocksStatus status={status} liveError={liveError} services={live.services.length} onRefresh={refresh} />
      </header>

      <SourcePicker
        count={sources.length}
        onAdd={(files) => {
          setPlan(undefined);
          setSources((current) => mergeSources(current, files));
        }}
        onClear={() => {
          setPlan(undefined);
          setSources([]);
          setSelected(new Set());
        }}
      />

      <main className="workspace">
        <CatalogTree catalog={catalog} live={live} applied={applied} selected={selected} onToggle={toggle} />
        <PlanPanel
          selectedCount={selected.size}
          canRun={Boolean(status?.reachable)}
          mode={plan?.mode}
          plan={plan?.plan}
          outcomes={outcomes}
          running={running}
          onPreview={preview}
          onApply={apply}
          onClearSelection={() => {
            setPlan(undefined);
            setSelected(new Set());
          }}
          onDismiss={() => {
            setPlan(undefined);
            setOutcomes([]);
          }}
        />
      </main>

      <Console />
    </div>
  );
}
