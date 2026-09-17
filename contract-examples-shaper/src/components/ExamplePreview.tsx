import { useEffect, useRef, useState } from 'react';
import type { ExampleRef, ParsedArtifact } from '../lib/artifacts/types';
import { previewFromArtifact, type ExchangePreview, type NameValue } from '../lib/preview';

/** What a tab of the preview shows: an exchange, a document as text, or why there is nothing to show. */
export type PreviewContent = { exchange: ExchangePreview } | { text: string } | { missing: string };

export interface PreviewTab {
  label: string;
  /** Called each time the tab is shown, so what Microcks holds is read afresh. */
  load: () => PreviewContent | Promise<PreviewContent>;
}

export interface PreviewRequest {
  title: string;
  subtitle?: string;
  tabs: PreviewTab[];
}

/** A tab reading an example from the source file that declares it. */
export function sourceFileTab(artifact: ParsedArtifact, ref: ExampleRef, label = `Source file · ${artifact.file.name}`): PreviewTab {
  return {
    label,
    load: () => {
      const exchange = previewFromArtifact(artifact, ref);
      return exchange ? { exchange } : { missing: `${artifact.file.name} holds no readable example ${ref.example} for ${ref.operation}.` };
    },
  };
}

function Headers({ headers }: { headers: NameValue[] }) {
  if (headers.length === 0) return null;
  return (
    <dl className="exchange-headers">
      {headers.map((h, i) => (
        <div key={`${h.name}:${i}`}>
          <dt>{h.name}</dt>
          <dd>{h.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Body({ body, empty }: { body?: string; empty: string }) {
  return body ? (
    <pre className="exchange-body">
      <code>{body}</code>
    </pre>
  ) : (
    <p className="muted exchange-empty">{empty}</p>
  );
}

/** An example drawn as the exchange it stands for. */
export function ExchangeView({ exchange }: { exchange: ExchangePreview }) {
  const { request, response, event } = exchange;
  return (
    <div className="exchange">
      {exchange.summary && <p className="exchange-summary">{exchange.summary}</p>}
      {event && (
        <section aria-label="Message">
          <h3>Message{event.mediaType && <span className="muted"> · {event.mediaType}</span>}</h3>
          <Headers headers={event.headers} />
          <Body body={event.payload} empty="No payload." />
        </section>
      )}
      {request && (
        <section aria-label="Request">
          <h3>Request</h3>
          <p className="exchange-line">
            <code>
              <strong>{request.method}</strong> {request.path}
            </code>
          </p>
          <Headers headers={request.headers} />
          <Body body={request.body} empty="No body." />
        </section>
      )}
      {response && (
        <section aria-label="Response">
          <h3>Response</h3>
          <p className="exchange-line">
            <code>
              <strong>{response.status ?? '—'}</strong>
              {response.mediaType && ` · ${response.mediaType}`}
            </code>
            {response.dispatchCriteria && (
              <span className="muted" title="How Microcks matches a request to this response">
                {' '}
                dispatched on <code>{response.dispatchCriteria}</code>
              </span>
            )}
          </p>
          <Headers headers={response.headers} />
          <Body body={response.body} empty="No body." />
        </section>
      )}
    </div>
  );
}

function TabContent({ tab }: { tab: PreviewTab }) {
  const [content, setContent] = useState<PreviewContent | { error: string }>();
  useEffect(() => {
    let cancelled = false;
    setContent(undefined);
    Promise.resolve()
      .then(tab.load)
      .then(
        (loaded) => !cancelled && setContent(loaded),
        (e: Error) => !cancelled && setContent({ error: e.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [tab]);

  if (!content) return <p className="muted">Loading…</p>;
  if ('error' in content) return <p className="error">{content.error}</p>;
  if ('missing' in content) return <p className="muted">{content.missing}</p>;
  if ('text' in content) {
    return (
      <pre className="exchange-body">
        <code>{content.text}</code>
      </pre>
    );
  }
  return <ExchangeView exchange={content.exchange} />;
}

/** A modal preview of one example, with a tab per place the example can be read from. */
export function PreviewDialog({ preview, onClose }: { preview: PreviewRequest; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  const tab = preview.tabs[Math.min(active, preview.tabs.length - 1)];

  return (
    <dialog
      ref={dialog}
      className="preview-dialog"
      aria-labelledby="preview-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="preview-frame">
        <header className="preview-header">
          <div>
            <h2 id="preview-title">{preview.title}</h2>
            {preview.subtitle && <p className="muted">{preview.subtitle}</p>}
          </div>
          <button type="button" className="secondary small" onClick={() => dialog.current?.close()} aria-label="Close preview">
            Close
          </button>
        </header>
        {preview.tabs.length > 1 && (
          <div className="tabs" role="tablist" aria-label="Read from">
            {preview.tabs.map((t, i) => (
              <button key={t.label} type="button" role="tab" aria-selected={t === tab} className={`tab${t === tab ? ' active' : ''}`} onClick={() => setActive(i)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        {tab && <TabContent key={tab.label} tab={tab} />}
      </div>
    </dialog>
  );
}
