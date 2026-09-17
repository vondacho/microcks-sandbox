import { useMemo, useState } from 'react';
import type { Catalog } from '../lib/artifacts/catalog';
import type { ArtifactKind, ParsedArtifact } from '../lib/artifacts/types';
import { liveServiceId, type LiveState } from '../lib/microcks/live-state';
import { fileLeaf } from '../lib/plan';
import { Check } from './Check';
import { buildView, filterService, inTab, leavesOf, type FileItem, type ItemState, type ServiceItem, type Tab } from '../lib/view';

interface Props {
  catalog: Catalog;
  live: LiveState;
  applied: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onToggle: (leaves: string[], checked: boolean) => void;
}

const KIND_LABELS: Record<ArtifactKind, string> = {
  openapi: 'OpenAPI',
  swagger: 'Swagger 2',
  asyncapi2: 'AsyncAPI 2',
  asyncapi3: 'AsyncAPI 3',
  postman: 'Postman',
  'postman-workspace': 'Postman workspace',
  apiexamples: 'APIExamples',
  apimetadata: 'APIMetadata',
  graphql: 'GraphQL',
  grpc: 'gRPC',
  soapui: 'SoapUI',
  har: 'HAR',
};

const TABS: { tab: Tab; label: string }[] = [
  { tab: 'all', label: 'All' },
  { tab: 'ready', label: 'Ready to load' },
  { tab: 'loaded', label: 'Loaded' },
];

const STATE_LABELS: Record<ItemState, string> = {
  loaded: 'loaded',
  ready: 'ready to load',
  'live-only': 'only in Microcks',
};

const EMPTY_TAB: Record<Tab, string> = {
  all: 'Choose a folder or fetch URLs to see their contracts and examples here, next to what Microcks holds.',
  ready: 'Nothing left to load: Microcks holds everything the sources offer.',
  loaded: 'Microcks holds nothing yet.',
};

function roleLabel(a: ParsedArtifact): string {
  if (a.role === 'primary') return 'contract';
  return a.kind === 'apimetadata' ? 'metadata' : 'companion';
}

function StateBadge({ state, children }: { state: ItemState; children?: React.ReactNode }) {
  return <span className={`badge state-${state}`}>{children ?? STATE_LABELS[state]}</span>;
}

function Counts({ counts }: { counts: Record<ItemState, number> }) {
  return (
    <span className="counts">
      {(Object.keys(STATE_LABELS) as ItemState[])
        .filter((state) => counts[state] > 0)
        .map((state) => (
          <StateBadge key={state} state={state}>
            {counts[state]} {STATE_LABELS[state]}
          </StateBadge>
        ))}
    </span>
  );
}

function fileBadge(file: FileItem) {
  if (file.examples) {
    const { loaded, total } = file.examples;
    return <StateBadge state={file.state}>{file.state === 'loaded' ? `${loaded}/${total} loaded` : 'ready to load'}</StateBadge>;
  }
  if (file.artifact?.kind === 'apimetadata') {
    return <StateBadge state={file.state}>{file.state === 'loaded' ? 'applied' : 'ready to apply'}</StateBadge>;
  }
  return <StateBadge state={file.state} />;
}

function FileRow({ file, selected, onToggle }: { file: FileItem } & Pick<Props, 'selected' | 'onToggle'>) {
  const a = file.artifact;
  return (
    <li className="row-item">
      <Check leaves={file.leaf ? [file.leaf] : []} selected={selected} onToggle={onToggle} label={`Select ${a?.file.path ?? file.artifactName}`} />
      <span className="file-name" title={a?.file.path}>
        {file.artifactName}
      </span>
      <span className="muted">
        {a ? `${KIND_LABELS[a.kind]} · ${roleLabel(a)}${file.leaf && a.kind !== 'apimetadata' ? ' · whole file' : ''}` : 'not in the sources'}
        {a?.file.origin === 'package' && ' · designed here'}
        {file.main && ' · service imported from it'}
      </span>
      {fileBadge(file)}
      {a?.warnings.map((w) => (
        <span key={w} className="badge badge-warn">
          {w}
        </span>
      ))}
    </li>
  );
}

function ServiceNode({ service, selected, onToggle }: { service: ServiceItem } & Pick<Props, 'selected' | 'onToggle'>) {
  const onlyInMicrocks = !service.contract;
  return (
    <details className="contract" open>
      <summary>
        <Check leaves={leavesOf(service)} selected={selected} onToggle={onToggle} label={`Select ${service.id}`} />
        <span className="contract-name">{service.name}</span>
        <span className="version">{service.version}</span>
        {onlyInMicrocks && <span className="muted">not in the sources{service.live && ` · ${service.live.type}`}</span>}
        <Counts counts={service.counts} />
      </summary>

      {service.contract && service.contract.warnings.length > 0 && (
        <ul className="warnings">
          {service.contract.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {service.files.length > 0 && (
        <>
          <h3>Files</h3>
          <ul className="rows">
            {service.files.map((file) => (
              <FileRow key={file.artifact?.file.path ?? `live:${file.artifactName}`} file={file} selected={selected} onToggle={onToggle} />
            ))}
          </ul>
        </>
      )}

      {service.operations.length > 0 && <h3>Examples by operation</h3>}
      {service.operations.map((op) => (
        <div key={op.name} className="operation">
          <div className="operation-name">
            <Check
              leaves={op.examples.flatMap((e) => (e.leaf ? [e.leaf] : []))}
              selected={selected}
              onToggle={onToggle}
              label={`Select the examples of ${op.name}`}
            />
            <code>{op.name}</code>
          </div>
          <ul className="rows">
            {op.examples.map((e) => (
              <li key={`${e.artifactName}:${e.example}:${e.state}`} className={`row-item example example-${e.state}`}>
                <Check leaves={e.leaf ? [e.leaf] : []} selected={selected} onToggle={onToggle} label={`Select ${e.example} from ${e.artifactName}`} />
                <span>{e.example}</span>
                <span className="muted">{e.artifactName}</span>
                <StateBadge state={e.state} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {onlyInMicrocks && (
        <p className="muted note">Without its files, its examples can't be picked one by one: select the service to delete it.</p>
      )}
    </details>
  );
}

export function CatalogTree({ catalog, live, applied, selected, onToggle }: Props) {
  const [tab, setTab] = useState<Tab>('all');
  const view = useMemo(() => buildView(catalog, live, applied), [catalog, live, applied]);
  const services = view.services.flatMap((s) => filterService(s, tab) ?? []);

  const unidentified = catalog.unidentified
    .map((a) => ({ artifact: a, service: live.services.find((s) => s.sourceArtifact === a.file.name) }))
    .filter(({ service }) => inTab(service ? 'loaded' : 'ready', tab));
  const empty = services.length === 0 && unidentified.length === 0 && (tab !== 'all' || catalog.invalid.length === 0);

  return (
    <section className="panel catalog" aria-label="Contracts">
      <div className="catalog-bar">
        <h2>Contracts</h2>
        <div className="tabs" role="tablist" aria-label="Show">
          {TABS.map(({ tab: t, label }) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {label} <span className="tab-count">{view.counts[t]}</span>
            </button>
          ))}
        </div>
      </div>

      {empty && <p className="muted empty">{EMPTY_TAB[tab]}</p>}

      {services.map((service) => (
        <ServiceNode key={service.id} service={service} selected={selected} onToggle={onToggle} />
      ))}

      {unidentified.length > 0 && (
        <details className="contract" open>
          <summary>
            <span className="contract-name">Named by Microcks on import</span>
          </summary>
          <ul className="rows">
            {unidentified.map(({ artifact: a, service }) => (
              <li key={a.file.path} className="row-item">
                <Check leaves={[fileLeaf(a.file.path)]} selected={selected} onToggle={onToggle} label={`Select ${a.file.path}`} />
                <span className="file-name">{a.file.name}</span>
                <span className="muted">{KIND_LABELS[a.kind]} · whole file</span>
                {service ? <StateBadge state="loaded">loaded as {liveServiceId(service)}</StateBadge> : <StateBadge state="ready" />}
              </li>
            ))}
          </ul>
        </details>
      )}

      {tab === 'all' && catalog.invalid.length > 0 && (
        <details className="contract" open>
          <summary>
            <span className="contract-name">Cannot be loaded</span>
          </summary>
          <ul className="rows">
            {catalog.invalid.map((a) => (
              <li key={a.file.path} className="row-item">
                <span className="check-placeholder" aria-hidden="true" />
                <span className="file-name" title={a.file.path}>
                  {a.file.name}
                </span>
                <span className="muted">{KIND_LABELS[a.kind]}</span>
                {a.warnings.map((w) => (
                  <span key={w} className="badge badge-warn">
                    {w}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}

      {tab === 'all' && catalog.unrecognized.length > 0 && (
        <details className="unrecognized">
          <summary className="muted">
            {catalog.unrecognized.length} file{catalog.unrecognized.length === 1 ? '' : 's'} Microcks would not recognize
          </summary>
          <ul>
            {catalog.unrecognized.map((f) => (
              <li key={f.path}>
                <code>{f.path}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
