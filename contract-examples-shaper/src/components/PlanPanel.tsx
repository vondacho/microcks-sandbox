import type { Mode, Plan, Step } from '../lib/plan';
import type { StepOutcome } from '../lib/runner';

interface Props {
  selectedCount: number;
  canRun: boolean;
  mode?: Mode;
  plan?: Plan;
  outcomes: StepOutcome[];
  running: boolean;
  onPreview: (mode: Mode) => void;
  onApply: () => void;
  onClearSelection: () => void;
  onDismiss: () => void;
}

function describe(step: Step): string {
  switch (step.type) {
    case 'upload': {
      const what = step.total > 0 ? ` with ${step.examples} of ${step.total} examples` : '';
      return `Upload ${step.artifactName} as ${step.mainArtifact ? 'main' : 'secondary'} artifact${what}`;
    }
    case 'delete':
      return `Delete service ${step.contractId}`;
    case 'blocked':
      return 'Cannot proceed';
  }
}

export function PlanPanel({ selectedCount, canRun, mode, plan, outcomes, running, onPreview, onApply, onClearSelection, onDismiss }: Props) {
  const finished = outcomes.length > 0 && !running;
  const blocked = plan?.steps.some((s) => s.type === 'blocked');

  return (
    <aside className="panel plan" aria-label="Plan">
      <h2>Load or unload</h2>
      <p>
        <strong>{selectedCount}</strong> item{selectedCount === 1 ? '' : 's'} selected
        {selectedCount > 0 && (
          <button type="button" className="link" onClick={onClearSelection} disabled={running}>
            clear
          </button>
        )}
      </p>
      <div className="row">
        <button type="button" onClick={() => onPreview('load')} disabled={!selectedCount || running}>
          Load selected…
        </button>
        <button type="button" className="danger" onClick={() => onPreview('unload')} disabled={!selectedCount || running}>
          Unload selected…
        </button>
      </div>

      {plan && (
        <div className="steps">
          <h3>{mode === 'load' ? 'Loading' : 'Unloading'} will</h3>
          {plan.steps.length === 0 ? (
            <p className="muted">Nothing to do: Microcks already holds what is selected{mode === 'unload' ? ', or none of it' : ''}.</p>
          ) : (
            <ol>
              {plan.steps.map((step, i) => {
                const outcome = outcomes[i];
                return (
                  <li key={i} className={`step step-${outcome?.status ?? (step.type === 'blocked' ? 'failed' : 'planned')}`}>
                    <div>
                      <span className="step-status" aria-hidden="true" />
                      {describe(step)}
                    </div>
                    <div className="muted">{step.reason}</div>
                    {outcome?.message && outcome.status !== 'done' && <div className="error">{outcome.message}</div>}
                  </li>
                );
              })}
            </ol>
          )}
          <div className="row">
            {!finished && plan.steps.length > 0 && (
              <button type="button" onClick={onApply} disabled={running || blocked || !canRun}>
                {running ? 'Running…' : 'Apply'}
              </button>
            )}
            <button type="button" className="secondary" onClick={onDismiss} disabled={running}>
              {finished ? 'Done' : 'Cancel'}
            </button>
          </div>
          {!canRun && <p className="error">Microcks is not reachable.</p>}
        </div>
      )}
    </aside>
  );
}
