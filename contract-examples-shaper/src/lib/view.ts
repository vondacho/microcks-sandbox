import type { Catalog, Contract } from './artifacts/catalog';
import type { ParsedArtifact } from './artifacts/types';
import { liveServiceId, type LiveService, type LiveState } from './microcks/live-state';
import { exampleLeaf, fileLeaf, leafStates, liveOnlyMessages, serviceLeaf } from './plan';

/*
 * The contract area shows sources and Microcks as one tree: every service once, each item marked with where it
 * stands. This module builds that tree; the component only draws it.
 */

/** `loaded`: in the sources and in Microcks. `ready`: in the sources only. `live-only`: in Microcks only. */
export type ItemState = 'loaded' | 'ready' | 'live-only';

export type Tab = 'all' | 'ready' | 'loaded';

export interface ExampleItem {
  operation: string;
  example: string;
  /** The artifact the example is (or would be) imported from. */
  artifactName: string;
  state: ItemState;
  /** What to select to load or unload it; live-only examples can't be picked on their own. */
  leaf?: string;
}

export interface FileItem {
  artifactName: string;
  /** Source file, when the sources hold one. */
  artifact?: ParsedArtifact;
  state: ItemState;
  /** For files whose examples are picked one by one: how many Microcks holds. */
  examples?: { loaded: number; total: number };
  /** Set for files picked as a whole. */
  leaf?: string;
  /** The service was imported from a main artifact of that name. */
  main: boolean;
}

export interface ServiceItem {
  /** `name:version` */
  id: string;
  name: string;
  version: string;
  contract?: Contract;
  live?: LiveService;
  files: FileItem[];
  operations: { name: string; examples: ExampleItem[] }[];
  counts: Record<ItemState, number>;
  /** For a service only in Microcks: select to delete it. */
  leaf?: string;
}

export interface CatalogView {
  services: ServiceItem[];
  counts: Record<Tab, number>;
}

const zero = (): Record<ItemState, number> => ({ loaded: 0, ready: 0, 'live-only': 0 });

function contractService(contract: Contract, live: LiveService | undefined, applied: ReadonlySet<string>): ServiceItem {
  const states = leafStates(contract, live, applied);
  const operations = new Map<string, ExampleItem[]>();
  const add = (item: ExampleItem) => operations.set(item.operation, [...(operations.get(item.operation) ?? []), item]);

  const files: FileItem[] = contract.files.map((artifact) => {
    const name = artifact.file.name;
    const leaf = fileLeaf(artifact.file.path);
    if (states.has(leaf)) {
      return { artifactName: name, artifact, state: states.get(leaf)!, leaf, main: live?.sourceArtifact === name };
    }
    let loaded = 0;
    for (const ref of artifact.examples) {
      const exampleLeafKey = exampleLeaf(artifact.file.path, ref);
      const state = states.get(exampleLeafKey)!;
      if (state === 'loaded') loaded++;
      add({ ...ref, artifactName: name, state, leaf: exampleLeafKey });
    }
    return {
      artifactName: name,
      artifact,
      state: loaded > 0 || live?.sourceArtifact === name ? 'loaded' : 'ready',
      examples: { loaded, total: artifact.examples.length },
      main: live?.sourceArtifact === name,
    };
  });

  if (live) {
    const foreign = liveOnlyMessages(contract, live);
    foreign.forEach((m) => add({ operation: m.operation, example: m.example, artifactName: m.sourceArtifact, state: 'live-only' }));
    const known = new Set(files.map((f) => f.artifactName));
    const artifacts = new Set([...(live.sourceArtifact ? [live.sourceArtifact] : []), ...foreign.map((m) => m.sourceArtifact)]);
    for (const name of artifacts) {
      if (!known.has(name)) files.push({ artifactName: name, state: 'live-only', main: live.sourceArtifact === name });
    }
  }

  return finish({
    id: contract.id,
    name: contract.service.name,
    version: contract.service.version,
    contract,
    live,
    files,
    operations: [...operations.entries()].map(([name, examples]) => ({ name, examples })),
  });
}

function liveOnlyService(live: LiveService): ServiceItem {
  const operations = new Map<string, ExampleItem[]>();
  for (const m of live.messages) {
    const item: ExampleItem = { operation: m.operation, example: m.example, artifactName: m.sourceArtifact, state: 'live-only' };
    operations.set(m.operation, [...(operations.get(m.operation) ?? []), item]);
  }
  const artifacts = new Set([...(live.sourceArtifact ? [live.sourceArtifact] : []), ...live.messages.map((m) => m.sourceArtifact)]);
  const id = liveServiceId(live);
  return finish({
    id,
    name: live.name,
    version: live.version,
    live,
    leaf: serviceLeaf(id),
    files: [...artifacts].map((name) => ({ artifactName: name, state: 'live-only', main: live.sourceArtifact === name })),
    operations: [...operations.entries()].map(([name, examples]) => ({ name, examples })),
  });
}

/** Counts items: examples, plus files picked as a whole. */
function finish(service: Omit<ServiceItem, 'counts'>): ServiceItem {
  const counts = zero();
  service.operations.forEach((op) => op.examples.forEach((e) => counts[e.state]++));
  service.files.forEach((f) => {
    if (f.leaf) counts[f.state]++;
  });
  if (service.leaf && service.operations.length === 0) counts['live-only']++;
  return { ...service, counts };
}

export function buildView(catalog: Catalog, live: LiveState, applied: ReadonlySet<string>): CatalogView {
  const liveById = new Map(live.services.map((s) => [liveServiceId(s), s]));
  const services = catalog.contracts.map((c) => contractService(c, liveById.get(c.id), applied));

  // Services the sources don't define. Those imported from a gRPC or SoapUI file of the sources are shown with it.
  const inSources = new Set(catalog.contracts.map((c) => c.id));
  const unidentifiedNames = new Set(catalog.unidentified.map((a) => a.file.name));
  for (const service of live.services) {
    if (!inSources.has(liveServiceId(service)) && !unidentifiedNames.has(service.sourceArtifact ?? '')) {
      services.push(liveOnlyService(service));
    }
  }
  services.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const total = zero();
  services.forEach((s) => (Object.keys(total) as ItemState[]).forEach((k) => (total[k] += s.counts[k])));
  for (const a of catalog.unidentified) {
    total[live.services.some((s) => s.sourceArtifact === a.file.name) ? 'loaded' : 'ready']++;
  }
  return {
    services,
    counts: { all: total.loaded + total.ready + total['live-only'], ready: total.ready, loaded: total.loaded + total['live-only'] },
  };
}

/** Whether an item in this state belongs in a tab. What Microcks holds counts as loaded, sources or not. */
export const inTab = (state: ItemState, tab: Tab): boolean =>
  tab === 'all' || (tab === 'ready' ? state === 'ready' : state !== 'ready');

/** The service as a tab shows it: only the operations, examples and files in that tab, or undefined if none. */
export function filterService(service: ServiceItem, tab: Tab): ServiceItem | undefined {
  if (tab === 'all') return service;
  const operations = service.operations
    .map((op) => ({ ...op, examples: op.examples.filter((e) => inTab(e.state, tab)) }))
    .filter((op) => op.examples.length > 0);
  const withExamples = new Set(operations.flatMap((op) => op.examples.map((e) => e.artifactName)));
  const files = service.files.filter((f) => (f.leaf || !f.examples ? inTab(f.state, tab) : withExamples.has(f.artifactName)));
  const serviceItself = service.leaf !== undefined && tab === 'loaded';
  if (operations.length === 0 && !files.some((f) => f.leaf) && !serviceItself) return undefined;
  return { ...service, operations, files };
}

/** The leaves a checkbox over these items selects: only those shown. */
export function leavesOf(service: ServiceItem): string[] {
  return [
    ...(service.leaf ? [service.leaf] : []),
    ...service.files.flatMap((f) => (f.leaf ? [f.leaf] : [])),
    ...service.operations.flatMap((op) => op.examples.flatMap((e) => (e.leaf ? [e.leaf] : []))),
  ];
}
