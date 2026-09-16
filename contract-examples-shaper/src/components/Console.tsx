import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clearJournal, getJournal, onCallSettled } from '../lib/api';
import type { JournalEntry } from '../lib/microcks/journal';

/** Lines of a command shown before it is folded; uploads carry the whole artifact. */
const FOLDED_LINES = 6;

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  // Outside a secure context there is no Clipboard API: fall back on a selected, off-screen textarea.
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('copy refused');
}

const tone = (status: number) => (status === 0 || status >= 400 ? 'fail' : 'ok');

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

export function CommandLine({ command }: { command: string }) {
  const [unfolded, setUnfolded] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const lines = command.split('\n');
  const folded = !unfolded && lines.length > FOLDED_LINES;

  useEffect(() => {
    if (copy === 'idle') return;
    const timer = setTimeout(() => setCopy('idle'), 1500);
    return () => clearTimeout(timer);
  }, [copy]);

  return (
    <div className="command">
      <pre>
        <code>{folded ? lines.slice(0, FOLDED_LINES).join('\n') : command}</code>
      </pre>
      <div className="command-actions">
        <button
          type="button"
          className="small"
          aria-label="Copy command to clipboard"
          onClick={() => copyText(command).then(() => setCopy('copied'), () => setCopy('failed'))}
        >
          {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
        {lines.length > FOLDED_LINES && (
          <button type="button" className="link" onClick={() => setUnfolded(!unfolded)}>
            {folded ? `show all ${lines.length} lines` : 'fold'}
          </button>
        )}
      </div>
    </div>
  );
}

export function ConsoleEntry({ entry }: { entry: JournalEntry }) {
  return (
    <li className={`journal-entry journal-${tone(entry.status)}`}>
      <div className="journal-head">
        <time dateTime={entry.at}>{time(entry.at)}</time>
        <span className="journal-status">{entry.status === 0 ? 'no answer' : entry.status}</span>
        <span className="journal-summary">{entry.summary}</span>
        <span className="muted">{entry.durationMs} ms</span>
      </div>
      {entry.outcome && <div className="journal-outcome">{entry.outcome}</div>}
      <CommandLine command={entry.command} />
    </li>
  );
}

/**
 * The journal of calls the server made to Microcks and Keycloak, as command lines to run again. New entries are
 * fetched whenever a call to the app's API settles, which is when there can be any.
 */
export function Console() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [open, setOpen] = useState(true);
  const last = useRef(0);
  const syncing = useRef<Promise<void> | undefined>(undefined);
  const again = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  const stuckToBottom = useRef(true);

  const sync = useCallback(async () => {
    // Settles come in bursts (one per service on a refresh): run one read at a time, and one more after it.
    if (syncing.current) {
      again.current = true;
      return syncing.current;
    }
    syncing.current = (async () => {
      do {
        again.current = false;
        try {
          const page = await getJournal(last.current);
          if (page.last < last.current) setEntries([]); // the server restarted
          last.current = page.last;
          if (page.entries.length > 0) setEntries((current) => [...current, ...page.entries].slice(-200));
        } catch {
          // The console is secondary: a missed read is caught up by the next one.
        }
      } while (again.current);
      syncing.current = undefined;
    })();
    return syncing.current;
  }, []);

  useEffect(() => {
    void sync();
    return onCallSettled(() => void sync());
  }, [sync]);

  const shown = onlyChanges ? entries.filter((e) => e.method !== 'GET') : entries;

  useLayoutEffect(() => {
    if (list.current && stuckToBottom.current) list.current.scrollTop = list.current.scrollHeight;
  }, [shown.length, open]);

  return (
    <section className="panel console" aria-label="Console">
      <div className="console-bar">
        <button type="button" className="link console-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} Console
        </button>
        <span className="muted">
          {shown.length} call{shown.length === 1 ? '' : 's'} to Microcks
        </span>
        <label className="console-filter">
          <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.currentTarget.checked)} /> Only changes
        </label>
        <button
          type="button"
          className="secondary small"
          disabled={entries.length === 0}
          onClick={async () => {
            await clearJournal();
            setEntries([]);
          }}
        >
          Clear
        </button>
      </div>
      {open &&
        (shown.length === 0 ? (
          <p className="muted console-empty">No calls yet. Calls to Microcks show up here as commands you can run again.</p>
        ) : (
          <>
            <p className="muted console-hint">
              Credentials are read from <code>MICROCKS_CLIENT_ID</code> and <code>MICROCKS_CLIENT_SECRET</code>; a token
              command exports <code>MICROCKS_TOKEN</code> for the commands after it.
            </p>
            <ol
              ref={list}
              className="journal"
              onScroll={(e) => {
                const el = e.currentTarget;
                stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
            >
              {shown.map((entry) => (
                <ConsoleEntry key={entry.seq} entry={entry} />
              ))}
            </ol>
          </>
        ))}
    </section>
  );
}
