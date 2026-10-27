/**
 * Durable client-side storage for the student exam window.
 *
 * An answer a student commits while the network is down has to survive a tab
 * reload, a browser crash and a closed laptop lid, so it goes to IndexedDB
 * rather than React state. IndexedDB is not universally available though —
 * Safari private windows, locked-down kiosk browsers and some embedded webviews
 * either hide it or throw on open — so this module probes it once and
 * transparently degrades to localStorage, then to an in-memory map. The queue
 * keeps working either way; the weaker backends just stop surviving a reload.
 *
 * Every public function swallows storage errors: losing a draft is a nuisance,
 * but a rejected promise in the middle of a live exam is a broken screen.
 */

const DB_NAME = 'axiom-offline';
const DB_VERSION = 1;
const LS_PREFIX = 'axiom.offline.';
/**
 * Safari private mode can leave `indexedDB.open` pending forever, so the probe
 * is bounded — but generously. A browser that has only just started is busy,
 * and giving up too early would abandon a perfectly good database for a weaker
 * backend that cannot see the answers already stored in it.
 */
const OPEN_TIMEOUT_MS = 8_000;

export const OUTBOX = 'outbox';
export const DRAFTS = 'drafts';

export type StoreName = typeof OUTBOX | typeof DRAFTS;
export type StorageKind = 'indexeddb' | 'localstorage' | 'memory';

/** One answer waiting to be delivered to the backend. */
export interface PendingAnswer {
  /**
   * `${studentId}:${examId}:${questionId}` — deliberately derived rather than
   * random, so re-queueing the same question overwrites instead of creating a
   * second record that could double-submit.
   */
  id: string;
  studentId: string;
  examId: string;
  examCode: string;
  questionId: string;
  /** 1-based position in the exam, used only to describe the record in the UI. */
  questionIndex: number;
  prompt: string;
  answer: string;
  /** Server-clock ms at the moment the student pressed submit. */
  clientSubmittedAt: number;
  /** The question's window, kept so the UI can explain how late a replay is. */
  pushedAt: number;
  endsAt: number;
  queuedAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
}

/** In-progress text for a question the student has not submitted yet. */
export interface AnswerDraft {
  id: string;
  studentId: string;
  examId: string;
  questionId: string;
  answer: string;
  updatedAt: number;
}

export function answerKey(studentId: string, examId: string, questionId: string): string {
  return `${studentId}:${examId}:${questionId}`;
}

interface Keyed {
  id: string;
}

interface Ops {
  all<T extends Keyed>(name: StoreName): Promise<T[]>;
  put(name: StoreName, record: Keyed): Promise<void>;
  del(name: StoreName, id: string): Promise<void>;
}

/* ── IndexedDB ──────────────────────────────────────────────── */

let dbHandle: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbHandle) return dbHandle;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      fn();
    };
    const timer = window.setTimeout(
      () => finish(() => reject(new Error('IndexedDB did not open in time'))),
      OPEN_TIMEOUT_MS
    );

    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error('IndexedDB unavailable')));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'id' });
    };
    request.onsuccess = () => finish(() => resolve(request.result));
    request.onerror = () => finish(() => reject(request.error ?? new Error('IndexedDB open failed')));
    request.onblocked = () => finish(() => reject(new Error('IndexedDB is blocked by another tab')));
  });

  // A failed open must not be cached, or one hiccup would disable storage for
  // the rest of the session.
  dbHandle = attempt.catch((err: Error) => {
    dbHandle = null;
    throw err;
  });
  return dbHandle;
}

function idbRequest<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(name, mode);
        transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
        const request = run(transaction.objectStore(name));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error ?? new Error('request failed'));
      })
  );
}

const idbOps: Ops = {
  all: <T extends Keyed>(name: StoreName) => idbRequest<T[]>(name, 'readonly', (store) => store.getAll()),
  put: (name, record) => idbRequest<unknown>(name, 'readwrite', (store) => store.put(record)).then(() => undefined),
  del: (name, id) => idbRequest<unknown>(name, 'readwrite', (store) => store.delete(id)).then(() => undefined)
};

/* ── localStorage ───────────────────────────────────────────── */

function lsRead<T>(name: StoreName): Record<string, T> {
  const raw = window.localStorage.getItem(LS_PREFIX + name);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function lsWrite(name: StoreName, map: Record<string, unknown>): void {
  window.localStorage.setItem(LS_PREFIX + name, JSON.stringify(map));
}

const lsOps: Ops = {
  async all<T extends Keyed>(name: StoreName) {
    return Object.values(lsRead<T>(name));
  },
  async put(name, record) {
    const map = lsRead<Keyed>(name);
    map[record.id] = record;
    lsWrite(name, map);
  },
  async del(name, id) {
    const map = lsRead<Keyed>(name);
    delete map[id];
    lsWrite(name, map);
  }
};

/* ── memory (last resort) ───────────────────────────────────── */

const memory = new Map<StoreName, Map<string, Keyed>>();

function memBucket(name: StoreName): Map<string, Keyed> {
  const existing = memory.get(name);
  if (existing) return existing;
  const bucket = new Map<string, Keyed>();
  memory.set(name, bucket);
  return bucket;
}

const memOps: Ops = {
  async all<T extends Keyed>(name: StoreName) {
    return [...memBucket(name).values()] as T[];
  },
  async put(name, record) {
    memBucket(name).set(record.id, record);
  },
  async del(name, id) {
    memBucket(name).delete(id);
  }
};

/* ── backend selection ──────────────────────────────────────── */

let kind: StorageKind = 'memory';
let active: Promise<Ops> | null = null;

/** Which backend is actually in use. Reported in the UI so support can see it. */
export function storageKind(): StorageKind {
  return kind;
}

function localStorageWorks(): boolean {
  try {
    const probe = `${LS_PREFIX}probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function backend(): Promise<Ops> {
  if (active) return active;
  active = (async () => {
    if ('indexedDB' in window && window.indexedDB) {
      try {
        await openDb();
        kind = 'indexeddb';
        return idbOps;
      } catch {
        /* fall through to the weaker backends */
      }
    }
    if (localStorageWorks()) {
      kind = 'localstorage';
      return lsOps;
    }
    kind = 'memory';
    return memOps;
  })();
  return active;
}

/** Drop to the next backend down after a live failure, and retry there. */
function degrade(): Promise<Ops> {
  if (kind === 'indexeddb') {
    dbHandle = null;
    if (localStorageWorks()) {
      kind = 'localstorage';
      active = Promise.resolve(lsOps);
    } else {
      kind = 'memory';
      active = Promise.resolve(memOps);
    }
  } else if (kind === 'localstorage') {
    kind = 'memory';
    active = Promise.resolve(memOps);
  }
  return active ?? Promise.resolve(memOps);
}

/* ── public API (never throws) ──────────────────────────────── */

/**
 * Reads from the active backend, and from the others too when they are
 * available. The queue has to be able to see an answer stored by an earlier
 * session even if this one picked a different backend — otherwise a slow
 * IndexedDB open on a cold start would make a saved answer invisible rather
 * than merely slower to reach. Duplicate ids are resolved in favour of the
 * active backend.
 */
export async function readAll<T extends Keyed>(name: StoreName): Promise<T[]> {
  if (typeof window === 'undefined') return [];
  const active = await backend().catch(() => memOps);
  const merged = new Map<string, T>();

  const absorb = async (ops: Ops) => {
    try {
      for (const row of await ops.all<T>(name)) {
        if (row && typeof row.id === 'string' && !merged.has(row.id)) merged.set(row.id, row);
      }
    } catch {
      /* an unavailable backend simply contributes nothing */
    }
  };

  await absorb(active);
  if (active !== idbOps && 'indexedDB' in window && window.indexedDB) await absorb(idbOps);
  if (active !== lsOps && localStorageWorks()) await absorb(lsOps);
  if (active !== memOps) await absorb(memOps);

  return [...merged.values()];
}

export async function readRecord<T extends Keyed>(name: StoreName, id: string): Promise<T | null> {
  const rows = await readAll<T>(name);
  return rows.find((row) => row.id === id) ?? null;
}

export async function writeRecord<T extends Keyed>(name: StoreName, record: T): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    await (await backend()).put(name, record);
    return true;
  } catch {
    try {
      await (await degrade()).put(name, record);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Deletes from every backend, not just the active one.
 *
 * A record can outlive the backend that wrote it: if IndexedDB is slow to open
 * on a cold start, the session falls back to localStorage and can no longer see
 * — or clear — what IndexedDB is still holding. For reads that is merely
 * unlucky, but for deletes it is a stuck queue: a delivered answer that nothing
 * can remove gets retried forever. Deleting a key that is not there is a no-op
 * everywhere, so sweeping all three is the cheap way to stay consistent.
 */
export async function deleteRecord(name: StoreName, id: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const sweep: Promise<unknown>[] = [];
  if ('indexedDB' in window && window.indexedDB) sweep.push(idbOps.del(name, id).catch(() => undefined));
  if (localStorageWorks()) sweep.push(lsOps.del(name, id).catch(() => undefined));
  sweep.push(memOps.del(name, id).catch(() => undefined));
  await Promise.all(sweep);
}
