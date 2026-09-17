import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import { CatalogTree, previewOf } from '../../src/components/CatalogTree';
import { ExchangeView } from '../../src/components/ExamplePreview';
import type { ExchangePreview } from '../../src/lib/preview';
import { buildView } from '../../src/lib/view';
import { ConsoleEntry } from '../../src/components/Console';
import { PlanPanel } from '../../src/components/PlanPanel';
import type { LiveState } from '../../src/lib/microcks/live-state';
import { buildPlan, leavesOfContract } from '../../src/lib/plan';
import { ALL_FIXTURES, fixture } from './support';

const catalog = buildCatalog(ALL_FIXTURES.map(fixture));
const petshop = catalog.contracts.find((c) => c.id === 'Pet Shop API:v1')!;
const openapi = petshop.primary!;

const live: LiveState = {
  services: [
    {
      id: 'svc-1',
      name: 'Pet Shop API',
      version: 'v1',
      type: 'REST',
      sourceArtifact: 'openapi-including-examples.json',
      messages: openapi.examples.filter((e) => e.example !== 'sell_bella').map((e) => ({ ...e, sourceArtifact: openapi.file.name })),
    },
    { id: 'svc-2', name: 'Legacy API', version: '0.9', type: 'REST', messages: [] },
  ],
};

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('CatalogTree', () => {
  const html = text(
    renderToStaticMarkup(<CatalogTree catalog={catalog} live={live} applied={new Set()} selected={new Set()} onToggle={() => {}} />),
  );

  it('offers tabs counting what is ready to load and what is loaded', () => {
    // Pet Shop alone: 9 loaded; ready are sell_bella, 3 APIExamples, the collection and the metadata.
    expect(html).toContain('All 23 Ready to load 13 Loaded 10');
  });

  it('shows each service with what Microcks holds and what is ready to load', () => {
    expect(html).toContain('Pet Shop API v1 9 loaded 6 ready to load');
    expect(html).toContain('openapi-including-examples.json OpenAPI · contract · service imported from it 9/10 loaded');
    expect(html).toContain('petshop-examples.yaml APIExamples · companion ready to load');
  });

  it('marks each example under its operation', () => {
    expect(html).toContain('sell_bella openapi-including-examples.json ready to load');
    expect(html).toContain('rex openapi-including-examples.json loaded');
  });

  it('shows services only in Microcks among the others, and files Microcks would not recognize', () => {
    expect(html).toContain('Legacy API 0.9 not in the sources · REST 1 only in Microcks');
    expect(html).toContain('1 file Microcks would not recognize');
  });
});

describe('PlanPanel', () => {
  it('describes the steps before they run', () => {
    const plan = buildPlan({ catalog, live, mode: 'unload', selected: new Set(leavesOfContract(petshop)), appliedFiles: new Set() });
    const html = text(
      renderToStaticMarkup(
        <PlanPanel
          selectedCount={3}
          canRun
          mode="unload"
          plan={plan}
          outcomes={[]}
          running={false}
          onPreview={() => {}}
          onApply={() => {}}
          onClearSelection={() => {}}
          onDismiss={() => {}}
        />,
      ),
    );
    expect(html).toContain('Unloading will');
    expect(html).toContain('Delete service Pet Shop API:v1');
  });
});

describe('ConsoleEntry', () => {
  const entry = {
    seq: 4,
    at: '2026-09-16T20:00:00.000Z',
    method: 'POST',
    url: 'http://mk/api/artifact/upload?mainArtifact=true',
    summary: 'Import openapi-including-examples.json as main artifact',
    command: ['curl -sS -X POST …', ...Array.from({ length: 10 }, (_, i) => `line ${i}`)].join('\n'),
    status: 400,
    durationMs: 12,
    outcome: 'Version property is missing',
  };
  const html = renderToStaticMarkup(<ConsoleEntry entry={entry} />);

  it('shows the call, its answer, and a way to copy the command', () => {
    expect(text(html)).toContain('400 Import openapi-including-examples.json as main artifact 12 ms Version property is missing');
    expect(html).toContain('journal-fail');
    expect(html).toContain('aria-label="Copy command to clipboard"');
  });

  it('folds long commands', () => {
    expect(html).toContain('line 4');
    expect(html).not.toContain('line 5');
    expect(text(html)).toContain('show all 11 lines');
  });
});

describe('Example preview', () => {
  const view = buildView(catalog, live, new Set());
  const service = view.services.find((s) => s.id === 'Pet Shop API:v1')!;
  const example = (name: string, artifact = 'openapi-including-examples.json') =>
    service.operations.flatMap((o) => o.examples).find((e) => e.example === name && e.artifactName === artifact)!;

  it('offers a preview on every example', () => {
    const html = renderToStaticMarkup(<CatalogTree catalog={catalog} live={live} applied={new Set()} selected={new Set()} onToggle={() => {}} />);
    expect(html).toContain('aria-label="Preview sell_bella from openapi-including-examples.json"');
    const examples = view.services.flatMap((s) => s.operations.flatMap((o) => o.examples));
    expect(html.match(/>Preview</g)).toHaveLength(examples.length);
  });

  it('reads an example from where it is: the file, Microcks, or both when loaded', () => {
    expect(previewOf(service, example('sell_bella')).tabs.map((t) => t.label)).toEqual(['Source file · openapi-including-examples.json']);
    expect(previewOf(service, example('rex')).tabs.map((t) => t.label)).toEqual(['Source file · openapi-including-examples.json', 'In Microcks']);
  });

  it('draws an exchange: request line, headers, bodies', async () => {
    const tab = previewOf(service, example('rex')).tabs[0];
    const content = await tab.load();
    expect('exchange' in content).toBe(true);
    const html = text(renderToStaticMarkup(<ExchangeView exchange={(content as { exchange: ExchangePreview }).exchange} />));
    expect(html).toContain('Request GET /api/pets/1 No body. Response 200 · application/json');
  });
});
