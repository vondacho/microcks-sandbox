/** One call made to Microcks or Keycloak, as the console shows it. */
export interface JournalEntry {
  /** Increases by one per entry, so that a reader can ask for what it hasn't seen yet. */
  seq: number;
  /** ISO timestamp of when the call was sent. */
  at: string;
  method: string;
  url: string;
  /** What the call was for, in words. */
  summary: string;
  /** A shell command line doing the same call. */
  command: string;
  /** HTTP status; 0 when no answer came back. */
  status: number;
  durationMs: number;
  /** A short account of the answer: the imported service, or why it failed. */
  outcome?: string;
}

export type JournalRecord = Omit<JournalEntry, 'seq'>;

export interface JournalPage {
  entries: JournalEntry[];
  /** The latest `seq`, to pass as `after` next time. */
  last: number;
}

/**
 * The calls of this server process, newest last. Bounded: upload commands carry the whole artifact, so old entries
 * are dropped rather than kept forever.
 */
export class Journal {
  private entries: JournalEntry[] = [];
  private seq = 0;

  constructor(private readonly capacity = 200) {}

  record(entry: JournalRecord): JournalEntry {
    const recorded = { ...entry, seq: ++this.seq };
    this.entries.push(recorded);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
    return recorded;
  }

  since(after = 0): JournalPage {
    return { entries: this.entries.filter((e) => e.seq > after), last: this.seq };
  }

  /** Empties the journal. Sequence numbers keep increasing, so a reader never mistakes new entries for seen ones. */
  clear(): void {
    this.entries = [];
  }
}
