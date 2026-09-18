import { useId } from 'react';
import type { Draft, DraftIssue } from '../../lib/design/draft';
import { concreteStatus, responseFor, sampleBody } from '../../lib/design/draft';
import { concreteMediaType, isJsonMediaType, type DesignContent, type DesignContract, type DesignOperation } from '../../lib/design/operations';

interface Props {
  design: DesignContract;
  op: DesignOperation;
  draft: Draft;
  issues: DraftIssue[];
  onChange: (draft: Draft) => void;
}

function Issues({ issues, field }: { issues: DraftIssue[]; field: string | ((f: string) => boolean) }) {
  const matching = issues.filter((i) => (typeof field === 'string' ? i.field === field : field(i.field)));
  if (matching.length === 0) return null;
  return (
    <ul className="issues">
      {matching.map((i) => (
        <li key={`${i.field}:${i.message}`} className={`issue issue-${i.severity}`}>
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function format(body: string | undefined): string | undefined {
  try {
    return body ? JSON.stringify(JSON.parse(body), null, 2) : body;
  } catch {
    return body;
  }
}

interface BodyProps {
  label: string;
  field: string;
  mediaType?: string;
  mediaTypes: string[];
  body?: string;
  issues: DraftIssue[];
  sample: () => string | undefined;
  onMediaType: (mediaType: string) => void;
  onBody: (body: string) => void;
}

function BodyEditor({ label, field, mediaType, mediaTypes, body, issues, sample, onMediaType, onBody }: BodyProps) {
  const id = useId();
  const options = [...new Set([...mediaTypes.map(concreteMediaType), ...(mediaType ? [mediaType] : [])])];
  return (
    <div className="body-editor">
      <div className="row">
        <label htmlFor={id}>{label}</label>
        <input
          className="media-type"
          list={`${id}-types`}
          value={mediaType ?? ''}
          placeholder="media type"
          aria-label={`${label} media type`}
          onChange={(e) => onMediaType(e.currentTarget.value)}
        />
        <datalist id={`${id}-types`}>
          {options.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <span className="spacer" />
        <button type="button" className="secondary small" onClick={() => onBody(sample() ?? '')}>
          Fill from schema
        </button>
        {isJsonMediaType(mediaType) && (
          <button type="button" className="secondary small" onClick={() => onBody(format(body) ?? '')}>
            Format
          </button>
        )}
      </div>
      <textarea
        id={id}
        className="code"
        rows={Math.min(18, Math.max(5, (body ?? '').split('\n').length + 1))}
        spellCheck={false}
        value={body ?? ''}
        placeholder={isJsonMediaType(mediaType) ? '{ }' : 'body'}
        onChange={(e) => onBody(e.currentTarget.value)}
      />
      <Issues issues={issues} field={field} />
    </div>
  );
}

const contentOf = (contents: DesignContent[], mediaType: string | undefined) =>
  contents.find((c) => concreteMediaType(c.mediaType) === mediaType) ?? contents[0];

/** Edits one draft against its operation. Every change is handed up as a new draft. */
export function DraftEditor({ design, op, draft, issues, onChange }: Props) {
  const nameId = useId();
  const statusId = useId();
  const update = (change: (d: Draft) => void) => {
    const next = structuredClone(draft);
    change(next);
    onChange(next);
  };
  const response = responseFor(op, draft.response.status);
  const statuses = [...new Set(op.responses.map((r) => concreteStatus(r.status)))];

  return (
    <div className="draft-editor">
      <div className="field">
        <label htmlFor={nameId}>Example name</label>
        <input id={nameId} value={draft.name} onChange={(e) => update((d) => (d.name = e.currentTarget.value))} />
        <Issues issues={issues} field="name" />
      </div>

      <fieldset>
        <legend>Request</legend>
        <Issues issues={issues} field="request" />
        {op.parameters.filter((p) => p.in !== 'cookie').length > 0 && (
          <table className="parameters">
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">In</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {op.parameters
                .filter((p) => p.in !== 'cookie')
                .map((p) => {
                  const values = p.in === 'header' ? draft.request.headers : draft.request.parameters;
                  const field = p.in === 'header' ? `header:${p.name}` : `parameter:${p.name}`;
                  return (
                    <tr key={`${p.in}:${p.name}`}>
                      <th scope="row">
                        <code>{p.name}</code>
                        {p.required && <span className="required" title="required"> *</span>}
                      </th>
                      <td className="muted">{p.in}</td>
                      <td>
                        <input
                          aria-label={`${p.name} (${p.in})`}
                          value={values[p.name] ?? ''}
                          placeholder={typeof p.schema?.type === 'string' ? p.schema.type : ''}
                          title={p.description}
                          onChange={(e) =>
                            update((d) => {
                              const target = p.in === 'header' ? d.request.headers : d.request.parameters;
                              target[p.name] = e.currentTarget.value;
                            })
                          }
                        />
                        <Issues issues={issues} field={field} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
        {op.requestBody ? (
          <BodyEditor
            label="Body"
            field="request.body"
            mediaType={draft.request.mediaType}
            mediaTypes={op.requestBody.contents.map((c) => c.mediaType)}
            body={draft.request.body}
            issues={issues}
            sample={() => sampleBody(design, contentOf(op.requestBody!.contents, draft.request.mediaType))}
            onMediaType={(t) => update((d) => (d.request.mediaType = t))}
            onBody={(b) => update((d) => (d.request.body = b))}
          />
        ) : (
          op.parameters.length === 0 && <p className="muted">This operation takes no parameters and no body.</p>
        )}
      </fieldset>

      <fieldset>
        <legend>Response</legend>
        <div className="field row">
          <label htmlFor={statusId}>Status</label>
          <input
            id={statusId}
            className="status-input"
            list={`${statusId}-list`}
            inputMode="numeric"
            value={draft.response.status}
            onChange={(e) => update((d) => (d.response.status = e.currentTarget.value.trim()))}
          />
          <datalist id={`${statusId}-list`}>
            {statuses.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {response?.description && <span className="muted">{response.description}</span>}
        </div>
        <Issues issues={issues} field="response.status" />

        {(response?.headers ?? []).map((h) => (
          <div key={h.name} className="field row">
            <label>
              <code>{h.name}</code>
              {h.required && <span className="required"> *</span>}
            </label>
            <input
              aria-label={`${h.name} response header`}
              value={draft.response.headers[h.name] ?? ''}
              onChange={(e) => update((d) => (d.response.headers[h.name] = e.currentTarget.value))}
            />
            <Issues issues={issues} field={`response.header:${h.name}`} />
          </div>
        ))}

        <BodyEditor
          label="Body"
          field="response.body"
          mediaType={draft.response.mediaType}
          mediaTypes={(response?.contents ?? []).map((c) => c.mediaType)}
          body={draft.response.body}
          issues={issues}
          sample={() => sampleBody(design, contentOf(response?.contents ?? [], draft.response.mediaType))}
          onMediaType={(t) => update((d) => (d.response.mediaType = t))}
          onBody={(b) => update((d) => (d.response.body = b))}
        />
      </fieldset>
      <Issues issues={issues} field="operation" />
    </div>
  );
}
