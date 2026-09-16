import type { Plan, Step } from './plan';

/** What running a plan needs from Microcks: the browser reaches it through the app's API, tests directly. */
export interface MicrocksPort {
  /** Resolves to the `name:version` Microcks reports for the imported service. */
  upload(artifactName: string, content: string, mainArtifact: boolean): Promise<string>;
  deleteService(serviceId: string): Promise<void>;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StepOutcome {
  status: StepStatus;
  message?: string;
}

/**
 * Runs the steps in order. When a step fails, the remaining steps of the same contract are skipped: they were
 * planned assuming it went through (a secondary artifact onto a service that was never created, say).
 * Returns the contracts whose steps all succeeded.
 */
export async function runPlan(
  plan: Plan,
  port: MicrocksPort,
  onProgress: (index: number, outcome: StepOutcome) => void = () => {},
): Promise<Set<string>> {
  const failed = new Set<string>();
  for (const [index, step] of plan.steps.entries()) {
    if (failed.has(step.contractId)) {
      onProgress(index, { status: 'skipped', message: 'An earlier step for this contract failed.' });
      continue;
    }
    onProgress(index, { status: 'running' });
    try {
      onProgress(index, { status: 'done', message: await runStep(step, port) });
    } catch (e) {
      failed.add(step.contractId);
      onProgress(index, { status: 'failed', message: (e as Error).message });
    }
  }
  return new Set(plan.steps.map((s) => s.contractId).filter((id) => !failed.has(id)));
}

async function runStep(step: Step, port: MicrocksPort): Promise<string | undefined> {
  switch (step.type) {
    case 'blocked':
      throw new Error(step.reason);
    case 'delete':
      await port.deleteService(step.serviceId);
      return undefined;
    case 'upload': {
      const imported = await port.upload(step.artifactName, step.content, step.mainArtifact);
      if (!step.contractId.startsWith('file:') && imported !== step.contractId) {
        throw new Error(`Microcks imported ${step.artifactName} as ${imported}, not ${step.contractId}`);
      }
      return imported;
    }
  }
}
