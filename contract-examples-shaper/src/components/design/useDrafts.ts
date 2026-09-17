import { useCallback, useEffect, useRef, useState } from 'react';
import type { Draft } from '../../lib/design/draft';
import { openDraftStore, type DraftStore } from '../../lib/design/store';

const SAVE_DELAY_MS = 400;

export type SaveState = 'loading' | 'saved' | 'saving' | 'failed';

/**
 * Drafts from the browser's store. Changes show at once and are written shortly after typing stops, one write per
 * draft; pending writes are flushed when the view goes away.
 */
export function useDrafts() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [state, setState] = useState<SaveState>('loading');
  const [persistent, setPersistent] = useState(true);
  const store = useRef<DraftStore | undefined>(undefined);
  const pending = useRef(new Map<string, { draft: Draft; timer: ReturnType<typeof setTimeout> }>());

  useEffect(() => {
    let cancelled = false;
    void openDraftStore().then(async (opened) => {
      if (cancelled) return;
      store.current = opened;
      setPersistent(opened.persistent);
      const all = await opened.all();
      if (!cancelled) {
        setDrafts(all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        setState('saved');
      }
    });
    const writes = pending.current;
    return () => {
      cancelled = true;
      for (const { draft, timer } of writes.values()) {
        clearTimeout(timer);
        void store.current?.put(draft);
      }
      writes.clear();
    };
  }, []);

  const write = useCallback(async (draft: Draft) => {
    pending.current.delete(draft.id);
    try {
      await store.current?.put(draft);
      if (pending.current.size === 0) setState('saved');
    } catch {
      setState('failed');
    }
  }, []);

  const save = useCallback(
    (draft: Draft, { immediately = false } = {}) => {
      const stamped = { ...draft, updatedAt: new Date().toISOString() };
      setDrafts((current) => (current.some((d) => d.id === draft.id) ? current.map((d) => (d.id === draft.id ? stamped : d)) : [...current, stamped]));
      setState('saving');
      const previous = pending.current.get(draft.id);
      if (previous) clearTimeout(previous.timer);
      if (immediately) {
        void write(stamped);
      } else {
        pending.current.set(draft.id, { draft: stamped, timer: setTimeout(() => void write(stamped), SAVE_DELAY_MS) });
      }
    },
    [write],
  );

  const remove = useCallback(async (id: string) => {
    const previous = pending.current.get(id);
    if (previous) clearTimeout(previous.timer);
    pending.current.delete(id);
    setDrafts((current) => current.filter((d) => d.id !== id));
    try {
      await store.current?.delete(id);
    } catch {
      setState('failed');
    }
  }, []);

  return { drafts, state, persistent, save, remove };
}
