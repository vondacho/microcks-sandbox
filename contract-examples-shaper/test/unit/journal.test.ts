import { describe, expect, it } from 'vitest';
import { Journal, type JournalRecord } from '../../src/lib/microcks/journal';

const call = (summary: string): JournalRecord => ({
  at: '2026-09-16T20:00:00.000Z',
  method: 'GET',
  url: 'http://mk/api/services',
  summary,
  command: 'curl',
  status: 200,
  durationMs: 3,
});

describe('Journal', () => {
  it('hands out what a reader has not seen yet', () => {
    const journal = new Journal();
    journal.record(call('a'));
    const first = journal.since(0);
    journal.record(call('b'));
    expect(first).toMatchObject({ last: 1, entries: [{ seq: 1, summary: 'a' }] });
    expect(journal.since(first.last)).toMatchObject({ last: 2, entries: [{ seq: 2, summary: 'b' }] });
  });

  it('keeps only the latest entries', () => {
    const journal = new Journal(2);
    ['a', 'b', 'c'].forEach((s) => journal.record(call(s)));
    expect(journal.since(0).entries.map((e) => e.summary)).toEqual(['b', 'c']);
  });

  it('keeps counting after being cleared', () => {
    const journal = new Journal();
    journal.record(call('a'));
    journal.clear();
    expect(journal.since(0)).toEqual({ entries: [], last: 1 });
    expect(journal.record(call('b')).seq).toBe(2);
  });
});
