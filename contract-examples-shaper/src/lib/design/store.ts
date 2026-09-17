import type { Draft } from './draft';

/** Where drafts are kept between visits. */
export interface DraftStore {
  all(): Promise<Draft[]>;
  put(draft: Draft): Promise<void>;
  delete(id: string): Promise<void>;
  /** Whether drafts outlive the page. False when the browser offers no IndexedDB (a private window, say). */
  readonly persistent: boolean;
}

export class MemoryDraftStore implements DraftStore {
  readonly persistent = false;
  private readonly drafts = new Map<string, Draft>();

  async all() {
    return [...this.drafts.values()].map((d) => structuredClone(d));
  }

  async put(draft: Draft) {
    this.drafts.set(draft.id, structuredClone(draft));
  }

  async delete(id: string) {
    this.drafts.delete(id);
  }
}

const DATABASE = 'contract-examples-shaper';
const STORE = 'drafts';

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Drafts in the browser's IndexedDB: kept across reloads, per browser profile and origin. */
export class IndexedDbDraftStore implements DraftStore {
  readonly persistent = true;

  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<IndexedDbDraftStore> {
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    return new IndexedDbDraftStore(await done(request));
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async all() {
    return (await done(this.store('readonly').getAll())) as Draft[];
  }

  async put(draft: Draft) {
    await done(this.store('readwrite').put(draft));
  }

  async delete(id: string) {
    await done(this.store('readwrite').delete(id));
  }
}

/** IndexedDB when the browser allows it, otherwise drafts last as long as the page. */
export async function openDraftStore(): Promise<DraftStore> {
  try {
    return await IndexedDbDraftStore.open();
  } catch {
    return new MemoryDraftStore();
  }
}
