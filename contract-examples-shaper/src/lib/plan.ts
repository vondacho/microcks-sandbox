import type { Catalog, Contract } from './artifacts/catalog';
import { exampleKey, filterArtifact } from './artifacts/filter';
import type { ExampleRef, ParsedArtifact } from './artifacts/types';
import { liveServiceId, type LiveMessage, type LiveService, type LiveState } from './microcks/live-state';

/*
 * Selection: the tree's checkboxes are leaves. An example that can be picked alone is a leaf; a file whose examples
 * can't be (or that has none, like metadata) is a leaf of its own; so is a service found only in Microcks.
 */
const SEP = '\u0001';
export const exampleLeaf = (path: string, ref: ExampleRef): string => ['ex', path, ref.operation, ref.example].join(SEP);
export const fileLeaf = (path: string): string => ['file', path].join(SEP);
export const serviceLeaf = (id: string): string => ['svc', id].join(SEP);

/** Whether the file's examples are picked one by one; otherwise the file is picked, and loaded, as a whole. */
const pickable = (a: ParsedArtifact): boolean => a.granular && a.examples.length > 0;

export const leavesOfFile = (a: ParsedArtifact): string[] =>
  pickable(a) ? a.examples.map((ref) => exampleLeaf(a.file.path, ref)) : [fileLeaf(a.file.path)];

export const leavesOfContract = (c: Contract): string[] => c.files.flatMap(leavesOfFile);

/**
 * Some files leave no trace Microcks reports back: APIMetadata, and companions without examples (a Postman collection
 * holding only test scripts). Which of those were applied is remembered by the UI, under this key.
 */
export const appliedKey = (contractId: string, artifactName: string): string => [contractId, artifactName].join(SEP);

const traceless = (a: ParsedArtifact): boolean => a.kind === 'apimetadata' || (a.role === 'secondary' && a.examples.length === 0);

export type LeafState = 'loaded' | 'ready';

/** Whether Microcks holds what each leaf of a contract stands for. */
export function leafStates(contract: Contract, live: LiveService | undefined, applied: ReadonlySet<string>): Map<string, LeafState> {
  const states = new Map<string, LeafState>();
  const messages = new Set((live?.messages ?? []).map((m) => `${m.sourceArtifact}${SEP}${exampleKey(m)}`));
  for (const f of contract.files) {
    const name = f.file.name;
    if (pickable(f)) {
      for (const ref of f.examples) {
        states.set(exampleLeaf(f.file.path, ref), live && messages.has(`${name}${SEP}${exampleKey(ref)}`) ? 'loaded' : 'ready');
      }
      continue;
    }
    const loaded =
      live !== undefined &&
      (traceless(f)
        ? applied.has(appliedKey(contract.id, name))
        : f === contract.primary
          ? live.sourceArtifact === name
          : live.messages.some((m) => m.sourceArtifact === name));
    states.set(fileLeaf(f.file.path), loaded ? 'loaded' : 'ready');
  }
  return states;
}

/**
 * Examples Microcks holds that no file of the sources accounts for: imported from a file the sources don't hold, or
 * no longer in the file that was imported. A file loaded as a whole accounts for everything imported from it.
 */
export function liveOnlyMessages(contract: Contract | undefined, live: LiveService): LiveMessage[] {
  const files = new Map((contract?.files ?? []).map((f) => [f.file.name, f]));
  return live.messages.filter((m) => {
    const f = files.get(m.sourceArtifact);
    return !f || (pickable(f) && !f.examples.some((ref) => exampleKey(ref) === exampleKey(m)));
  });
}

/** The applied files once a plan has run: updated for the contracts whose steps all succeeded. */
export function mergeApplied(applied: ReadonlySet<string>, plan: Plan, succeeded: ReadonlySet<string>): Set<string> {
  const next = new Set(applied);
  for (const [contractId, names] of Object.entries(plan.appliedFiles)) {
    if (!succeeded.has(contractId)) continue;
    [...next].filter((key) => key.startsWith(appliedKey(contractId, ''))).forEach((key) => next.delete(key));
    names.forEach((name) => next.add(appliedKey(contractId, name)));
  }
  return next;
}

export type Mode = 'load' | 'unload';

export type Step =
  | {
      type: 'upload';
      contractId: string;
      path: string;
      artifactName: string;
      mainArtifact: boolean;
      content: string;
      /** Examples the uploaded content holds, out of `total` in the source file. */
      examples: number;
      total: number;
      reason: string;
    }
  | { type: 'delete'; contractId: string; serviceId: string; reason: string }
  | { type: 'blocked'; contractId: string; reason: string };

export interface Plan {
  steps: Step[];
  /** Per contract, the files without a trace in Microcks that are applied once all its steps have succeeded. */
  appliedFiles: Record<string, string[]>;
}

export interface PlanInput {
  catalog: Catalog;
  live: LiveState;
  selected: ReadonlySet<string>;
  mode: Mode;
  /** Keys made with {@link appliedKey}. */
  appliedFiles: ReadonlySet<string>;
}

export function buildPlan({ catalog, live, selected, mode, appliedFiles }: PlanInput): Plan {
  const steps: Step[] = [];
  const appliedAfter: Record<string, string[]> = {};
  const liveById = new Map(live.services.map((s) => [liveServiceId(s), s]));

  for (const contract of catalog.contracts) {
    if (!leavesOfContract(contract).some((leaf) => selected.has(leaf))) continue;
    const planner = new ContractPlanner(contract, liveById.get(contract.id), selected, appliedFiles);
    const contractSteps = mode === 'load' ? planner.load() : planner.unload();
    const blocked = contractSteps.filter((s) => s.type === 'blocked');
    steps.push(...(blocked.length > 0 ? blocked : contractSteps));
    if (blocked.length === 0) appliedAfter[contract.id] = [...planner.applied];
  }

  for (const artifact of catalog.unidentified) {
    if (!selected.has(fileLeaf(artifact.file.path))) continue;
    const id = `file:${artifact.file.path}`;
    const service = live.services.find((s) => s.sourceArtifact === artifact.file.name);
    if (mode === 'load') {
      steps.push(upload(id, artifact, true, artifact.file.content, 'Load the whole file; Microcks names the service.'));
    } else if (service) {
      steps.push({ type: 'delete', contractId: id, serviceId: service.id, reason: `Delete ${liveServiceId(service)}, imported from ${artifact.file.name}.` });
    }
  }

  const known = new Set(catalog.contracts.map((c) => c.id));
  for (const service of live.services) {
    const id = liveServiceId(service);
    if (mode === 'unload' && !known.has(id) && selected.has(serviceLeaf(id))) {
      steps.push({ type: 'delete', contractId: id, serviceId: service.id, reason: `Delete ${id}.` });
    }
  }

  return { steps, appliedFiles: appliedAfter };
}

function upload(contractId: string, a: ParsedArtifact, main: boolean, content: string, reason: string, kept?: number): Step {
  return {
    type: 'upload',
    contractId,
    path: a.file.path,
    artifactName: a.file.name,
    mainArtifact: main,
    content,
    examples: kept ?? a.examples.length,
    total: a.examples.length,
    reason,
  };
}

class ContractPlanner {
  /** Names of the traceless files applied once the plan has run. */
  readonly applied: Set<string>;
  private readonly states: Map<string, LeafState>;

  constructor(
    private readonly contract: Contract,
    private readonly live: LiveService | undefined,
    private readonly selected: ReadonlySet<string>,
    applied: ReadonlySet<string>,
  ) {
    this.applied = new Set(
      live ? contract.files.filter((f) => traceless(f) && applied.has(appliedKey(contract.id, f.file.name))).map((f) => f.file.name) : [],
    );
    this.states = leafStates(contract, live, applied);
  }

  private touched = (f: ParsedArtifact) => leavesOfFile(f).some((leaf) => this.selected.has(leaf));

  private selectedExamples = (f: ParsedArtifact): Set<string> =>
    new Set(f.examples.filter((ref) => this.selected.has(exampleLeaf(f.file.path, ref))).map(exampleKey));

  /** Examples of this file Microcks holds, as imported from this file. */
  private loadedExamples(f: ParsedArtifact): Set<string> {
    const inFile = new Set(f.examples.map(exampleKey));
    return new Set(
      (this.live?.messages ?? [])
        .filter((m) => m.sourceArtifact === f.file.name)
        .map(exampleKey)
        .filter((key) => inFile.has(key)),
    );
  }

  /**
   * Unloading deletes the service when everything is selected, or when the service was created from this contract and
   * every loaded leaf is selected: taking out all of it leaves nothing worth keeping a service for.
   */
  private unloadsEverything(): boolean {
    const leaves = leavesOfContract(this.contract);
    if (leaves.every((leaf) => this.selected.has(leaf))) return true;
    const loaded = leaves.filter((leaf) => this.states.get(leaf) === 'loaded');
    const primary = this.contract.primary;
    return (
      primary !== undefined &&
      this.live?.sourceArtifact === primary.file.name &&
      loaded.length > 0 &&
      loaded.every((leaf) => this.selected.has(leaf))
    );
  }

  private hasMessagesFrom = (f: ParsedArtifact) => (this.live?.messages ?? []).some((m) => m.sourceArtifact === f.file.name);

  private uploadExamples(f: ParsedArtifact, keep: Set<string>, reason: string): Step {
    const main = f === this.contract.primary;
    return upload(this.contract.id, f, main, filterArtifact(f, keep), reason, keep.size);
  }

  private uploadWhole(f: ParsedArtifact, reason: string): Step {
    return upload(this.contract.id, f, f === this.contract.primary, f.file.content, reason);
  }

  /** Metadata goes last: a main artifact import resets the dispatchers it sets. */
  private metadataSteps(reason: string): Step[] {
    return this.contract.files
      .filter((f) => f.kind === 'apimetadata' && this.applied.has(f.file.name))
      .map((f) => this.uploadWhole(f, reason));
  }

  load(): Step[] {
    const { contract, live } = this;
    const primary = contract.primary;
    const steps: Step[] = [];
    let primaryUploaded = false;

    if (!live) {
      if (!primary) {
        return [{ type: 'blocked', contractId: contract.id, reason: `${contract.id} is not in Microcks and the sources hold no contract to create it.` }];
      }
      // The service has to exist before anything can be attached to it: Microcks skips secondaries silently.
      steps.push(
        pickable(primary)
          ? this.uploadExamples(primary, this.selectedExamples(primary), 'Create the service.')
          : this.uploadWhole(primary, 'Create the service.'),
      );
      primaryUploaded = true;
    }

    for (const f of contract.files) {
      if (f.kind === 'apimetadata') {
        if (this.touched(f)) this.applied.add(f.file.name);
        continue;
      }
      if (!this.touched(f) || (f === primary && primaryUploaded)) continue;
      if (traceless(f)) this.applied.add(f.file.name);
      if (pickable(f)) {
        const loaded = this.loadedExamples(f);
        const target = new Set([...loaded, ...this.selectedExamples(f)]);
        const primaryMissing = f === primary && live?.sourceArtifact !== f.file.name;
        if (target.size !== loaded.size || primaryMissing) {
          steps.push(this.uploadExamples(f, target, `Add ${target.size - loaded.size} example(s).`));
          primaryUploaded ||= f === primary;
        }
      } else {
        steps.push(this.uploadWhole(f, this.hasMessagesFrom(f) ? 'Reload the whole file.' : 'Load the whole file.'));
        primaryUploaded ||= f === primary;
      }
    }

    const newlyApplied = contract.files.filter((f) => f.kind === 'apimetadata' && this.touched(f)).length > 0;
    if (primaryUploaded || newlyApplied) {
      steps.push(...this.metadataSteps(primaryUploaded && !newlyApplied ? 'Re-apply metadata reset by the contract import.' : 'Apply metadata.'));
    }
    return steps;
  }

  unload(): Step[] {
    const { contract, live } = this;
    if (!live) return [];

    if (this.unloadsEverything()) {
      this.applied.clear();
      const foreign = liveOnlyMessages(contract, live).length;
      const also = foreign > 0 ? `, including ${foreign} example(s) that are not in the sources` : '';
      return [{ type: 'delete', contractId: contract.id, serviceId: live.id, reason: `Delete ${contract.id} and everything loaded into it${also}.` }];
    }

    const steps: Step[] = [];
    const primary = contract.primary;
    let primaryUploaded = false;
    let metadataRemoved = false;

    for (const f of contract.files) {
      // Only what Microcks holds can be taken out: selected leaves still ready to load are left alone.
      if (!leavesOfFile(f).some((leaf) => this.selected.has(leaf) && this.states.get(leaf) === 'loaded')) continue;
      if (f.kind === 'apimetadata') {
        metadataRemoved ||= this.applied.delete(f.file.name);
        continue;
      }
      if (!pickable(f)) {
        return [{ type: 'blocked', contractId: contract.id, reason: `${f.file.name} can only be unloaded together with the whole of ${contract.id}.` }];
      }
      const loaded = this.loadedExamples(f);
      const removed = this.selectedExamples(f);
      const target = new Set([...loaded].filter((key) => !removed.has(key)));
      if (target.size !== loaded.size) {
        steps.push(this.uploadExamples(f, target, `Remove ${loaded.size - target.size} example(s).`));
        primaryUploaded ||= f === primary;
      }
    }

    if (metadataRemoved && !primaryUploaded) {
      // Metadata can't be taken back: the contract is imported again to reset what it set.
      if (!primary) {
        return [{ type: 'blocked', contractId: contract.id, reason: `Unloading metadata re-imports the contract of ${contract.id}, which the sources do not hold.` }];
      }
      const current = pickable(primary) ? this.loadedExamples(primary) : undefined;
      steps.unshift(
        current
          ? this.uploadExamples(primary, current, 'Re-import the contract to reset metadata.')
          : this.uploadWhole(primary, 'Re-import the contract to reset metadata.'),
      );
      primaryUploaded = true;
    }

    if (primaryUploaded) steps.push(...this.metadataSteps('Re-apply the metadata that stays loaded.'));
    return steps;
  }
}
