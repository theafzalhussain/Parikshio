'use client';

/**
 * The offline outbox.
 *
 * A student presses "Submit", the POST fails because the bus went into a
 * tunnel, and the answer must not evaporate. It is written to durable storage
 * (see `offlineStore`) and this module keeps trying to deliver it until the
 * backend either accepts it or tells us, in so many words, that it never will.
 *
 * Deliberately a module singleton rather than React context: the queue has to
 * outlive the exam page, keep draining while the student is staring at the
 * lobby, and behave identically no matter how many components are watching it.
 */

import type { ExamPublic, LeaderboardEntry } from '@shared/types';
import { ApiError, api } from './api';
import {
  DRAFTS,
  OUTBOX,
  answerKey,
  deleteRecord,
  readRecord,
  readAll,
  storageKind,
  writeRecord,
  type AnswerDraft,
  type PendingAnswer,
  type StorageKind
} from './offlineStore';

/** What `POST /student/answers` returns on success. */
export interface AnswerReceipt {
  exam: ExamPublic;
  leaderboard: LeaderboardEntry[];
  response: { latencyMs: number };
}

export type SyncOutcome =
  /** The backend accepted the replayed answer. */
  | { status: 'synced'; record: PendingAnswer; receipt: AnswerReceipt }
  /** It had already been recorded — an earlier attempt got through after all. */
  | { status: 'duplicate'; record: PendingAnswer; message: string }
  /** The backend refused it for good (question closed, session over). */
  | { status: 'rejected'; record: PendingAnswer; message: string };

export interface OutboxSnapshot {
  /** Durable storage has been read; before this the queue may look empty when it is not. */
  ready: boolean;
  /** The browser's own verdict on connectivity. Optimistic by design — a failed POST is the real test. */
  online: boolean;
  syncing: boolean;
  /** Queued answers belonging to the signed-in student, oldest first. */
  pending: PendingAnswer[];
  lastSyncedAt: number | null;
  storage: StorageKind;
}

export type QueueInput = Omit<PendingAnswer, 'id' | 'queuedAt' | 'attempts' | 'lastAttemptAt' | 'lastError'>;

/** How often a queue that still has work retries on its own. */
const RETRY_MS = 7_000;
/**
 * Records older than this are dropped unread. The backend would refuse them
 * anyway, and a week-old answer resurfacing as an error toast helps nobody.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

const EMPTY: OutboxSnapshot = {
  ready: false,
  online: true,
  syncing: false,
  pending: [],
  lastSyncedAt: null,
  storage: 'memory'
};

let snapshot: OutboxSnapshot = EMPTY;
/** Every record in storage, including any left behind by another student on a shared device. */
let records: PendingAnswer[] = [];
let owner: string | null = null;
let booted = false;
let draining = false;

const watchers = new Set<(next: OutboxSnapshot) => void>();
const outcomeWatchers = new Set<(outcome: SyncOutcome) => void>();

function browserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // `navigator.onLine` only proves a network interface exists, so treat anything
  // other than an explicit `false` as "worth trying".
  return navigator.onLine !== false;
}

function publish(patch: Partial<OutboxSnapshot> = {}): void {
  snapshot = {
    ...snapshot,
    ...patch,
    online: browserOnline(),
    storage: storageKind(),
    pending: records
      .filter((record) => record.studentId === owner)
      .sort((a, b) => a.clientSubmittedAt - b.clientSubmittedAt)
  };
  watchers.forEach((watcher) => watcher(snapshot));
}

function announce(outcome: SyncOutcome): void {
  outcomeWatchers.forEach((watcher) => watcher(outcome));
}

/* ── subscriptions ──────────────────────────────────────────── */

export function getOutboxSnapshot(): OutboxSnapshot {
  return snapshot;
}

/** The value every consumer renders before the first effect runs, so SSR matches. */
export function getInitialSnapshot(): OutboxSnapshot {
  return EMPTY;
}

export function subscribeOutbox(watcher: (next: OutboxSnapshot) => void): () => void {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

/** Called by the exam screen so it can fold a delivered answer back into its state. */
export function onSyncOutcome(watcher: (outcome: SyncOutcome) => void): () => void {
  outcomeWatchers.add(watcher);
  return () => {
    outcomeWatchers.delete(watcher);
  };
}

/* ── lifecycle ──────────────────────────────────────────────── */

export function initOutbox(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;

  window.addEventListener('online', () => {
    publish();
    void flushOutbox('browser-online');
  });
  window.addEventListener('offline', () => publish());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOutbox('tab-visible');
  });
  // Backstop for the cases the events miss: captive portals, VPN handoffs, and
  // a `navigator.onLine` that never flipped back.
  window.setInterval(() => {
    if (snapshot.online !== browserOnline()) publish();
    void flushOutbox('heartbeat');
  }, RETRY_MS);

  void hydrate();
}

async function hydrate(): Promise<void> {
  const rows = await readAll<PendingAnswer>(OUTBOX);
  const cutoff = Date.now() - MAX_AGE_MS;
  const stale = rows.filter((row) => !Number.isFinite(row.queuedAt) || row.queuedAt < cutoff);
  const staleIds = new Set(stale.map((row) => row.id));
  records = rows.filter((row) => !staleIds.has(row.id));
  await Promise.all(stale.map((row) => deleteRecord(OUTBOX, row.id)));
  publish({ ready: true });
  void flushOutbox('hydrate');
}

/**
 * Binds the queue to the signed-in student. Records belonging to anyone else
 * stay untouched in storage until that account signs in again — two students
 * sharing a lab machine must never inherit each other's answers.
 */
export function setOutboxOwner(studentId: string | null): void {
  if (owner === studentId) return;
  owner = studentId;
  publish();
  if (studentId) void flushOutbox('owner-changed');
}

/* ── queue mutations ────────────────────────────────────────── */

export async function enqueueAnswer(input: QueueInput): Promise<PendingAnswer> {
  const record: PendingAnswer = {
    ...input,
    id: answerKey(input.studentId, input.examId, input.questionId),
    queuedAt: Date.now(),
    attempts: 0
  };
  records = [...records.filter((row) => row.id !== record.id), record];
  await writeRecord(OUTBOX, record);
  publish();
  void flushOutbox('enqueue');
  return record;
}

/** Give up on a queued answer (student-initiated). */
export async function discardAnswer(id: string): Promise<void> {
  records = records.filter((row) => row.id !== id);
  await deleteRecord(OUTBOX, id);
  publish();
}

async function forget(id: string): Promise<void> {
  records = records.filter((row) => row.id !== id);
  await deleteRecord(OUTBOX, id);
}

async function noteAttempt(record: PendingAnswer, error: string): Promise<void> {
  const updated: PendingAnswer = {
    ...record,
    attempts: record.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError: error
  };
  records = records.map((row) => (row.id === record.id ? updated : row));
  await writeRecord(OUTBOX, updated);
}

/* ── delivery ───────────────────────────────────────────────── */

/**
 * `done`  — settled one way or the other, move on to the next record.
 * `retry` — the network or the server is unavailable; stop and wait.
 * `halt`  — the session is dead; keep the queue for the next sign-in.
 */
type Verdict = 'done' | 'retry' | 'halt';

async function deliver(record: PendingAnswer): Promise<Verdict> {
  try {
    const receipt = await api<AnswerReceipt>('/student/answers', {
      method: 'POST',
      body: {
        examId: record.examId,
        questionId: record.questionId,
        answer: record.answer,
        offline: true
      }
    });
    await forget(record.id);
    await clearAnswerDraft(record.studentId, record.examId, record.questionId);
    announce({ status: 'synced', record, receipt });
    return 'done';
  } catch (err) {
    if (!(err instanceof ApiError)) {
      // `api()` only throws ApiError or the fetch rejection itself, so anything
      // else here means the request never reached the server.
      await noteAttempt(record, 'No connection');
      return 'retry';
    }
    if (err.status === 401) return 'halt';
    if (err.status === 429 || err.status >= 500) {
      await noteAttempt(record, err.message);
      return 'retry';
    }
    // Any other 4xx is the backend's final word: the question closed, the
    // session ended, or this answer was already counted. Retrying cannot help.
    await forget(record.id);
    await clearAnswerDraft(record.studentId, record.examId, record.questionId);
    announce(
      err.code === 'duplicate'
        ? { status: 'duplicate', record, message: err.message }
        : { status: 'rejected', record, message: err.message }
    );
    return 'done';
  }
}

export async function flushOutbox(reason = 'manual'): Promise<void> {
  if (typeof window === 'undefined' || draining || !owner) return;
  const queue = snapshot.pending;
  if (!queue.length) return;
  if (!browserOnline()) {
    publish();
    return;
  }

  draining = true;
  publish({ syncing: true });
  if (process.env.NODE_ENV === 'development') {
    console.debug(`[outbox] draining ${queue.length} answer(s) — ${reason}`);
  }
  let delivered = 0;
  try {
    // Oldest first, one at a time: the backend's duplicate check is per
    // question, and a serial drain keeps the leaderboard payloads ordered.
    for (const record of queue) {
      const verdict = await deliver(record);
      if (verdict === 'done') delivered += 1;
      else break;
    }
  } finally {
    draining = false;
    publish({
      syncing: false,
      ...(delivered > 0 ? { lastSyncedAt: Date.now() } : {})
    });
  }
}

/**
 * True when a failed request means "the answer never reached the server", as
 * opposed to "the server looked at it and said no". Only the former is worth
 * putting in the outbox.
 */
export function isTransportFailure(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status === 429 || err.status >= 500;
}

/* ── drafts ─────────────────────────────────────────────────── */

export async function saveAnswerDraft(input: Omit<AnswerDraft, 'id' | 'updatedAt'>): Promise<void> {
  await writeRecord(DRAFTS, {
    ...input,
    id: answerKey(input.studentId, input.examId, input.questionId),
    updatedAt: Date.now()
  } satisfies AnswerDraft);
}

export async function readAnswerDraft(
  studentId: string,
  examId: string,
  questionId: string
): Promise<string | null> {
  const row = await readRecord<AnswerDraft>(DRAFTS, answerKey(studentId, examId, questionId));
  return row?.answer ?? null;
}

export async function clearAnswerDraft(studentId: string, examId: string, questionId: string): Promise<void> {
  await deleteRecord(DRAFTS, answerKey(studentId, examId, questionId));
}
