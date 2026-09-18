import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/lib/artifacts/catalog';
import { DraftEditor } from '../../src/components/design/DraftEditor';
import { PackagePanel } from '../../src/components/design/PackagePanel';
import { draftIssues, newDraft } from '../../src/lib/design/draft';
import { designContract, type DesignContract } from '../../src/lib/design/operations';
import { SchemaValidator } from '../../src/lib/design/schema';
import { fixture } from './support';

const design = designContract(buildCatalog([fixture('openapi.json')]).contracts[0]) as DesignContract;
const put = design.operations.find((o) => o.name === 'PUT /api/pets/{id}')!;
const validator = new SchemaValidator(design.document, design.openapi);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const sell = newDraft(design, put, 'sell_bella');
sell.request.parameters.id = '';
sell.request.body = JSON.stringify({ name: 'Bella', category: 'DOG', status: 'GONE', price: 420 });
const issues = draftIssues(sell, put, { design, validator, siblings: [sell], existing: [] });

describe('DraftEditor', () => {
  const html = renderToStaticMarkup(<DraftEditor design={design} op={put} draft={sell} issues={issues} onChange={() => {}} />);

  it('lays out the operation parameters, body and response for editing', () => {
    expect(text(html)).toContain('Parameter In Value id * path');
    expect(html).toContain('aria-label="id (path)"');
    expect(html).toContain('&quot;status&quot;:&quot;GONE&quot;');
    expect(text(html)).toContain('Response Status');
  });

  it('shows each issue next to what it is about', () => {
    expect(html).toContain('<li class="issue issue-error">The path parameter id needs a value.</li>');
    expect(html).toContain('<li class="issue issue-warning">/status must be equal to one of the allowed values: &quot;AVAILABLE&quot;, &quot;PENDING&quot;, &quot;SOLD&quot;</li>');
  });
});

describe('PackagePanel', () => {
  const rex = newDraft(design, design.operations[0], 'rex');
  rex.request.parameters.id = '1';
  const html = text(
    renderToStaticMarkup(
      <PackagePanel
        designs={[design]}
        drafts={[rex, sell]}
        issues={new Map([[sell.id, issues], [rex.id, []]])}
        onOpen={() => {}}
        onAddToSources={() => []}
      />,
    ),
  );

  it('lists drafts per contract, flagging those that cannot be packaged yet', () => {
    expect(html).toContain('Pet Shop API v1 rex GET /api/pets/{id} sell_bella PUT /api/pets/{id} 1 to fix 1 warning');
    expect(html).toContain('File name');
    expect(html).toContain('0 examples in 0 files Download Add to sources Preview');
  });
});

