import mongoose, { Schema } from 'mongoose';
import { config } from './config';
import { store, type ContactMessage, type ContactStatus, type OwnerSession } from './store';
import { hydrateAudit, setAuditSink, type AuditEntry } from './security';

/**
 * MongoDB persistence mirror.
 * The in-memory store stays the hot read path (O(1) reads, zero query latency
 * during a live exam); every mutation is written through to MongoDB, and on
 * boot the collections are hydrated back into memory.
 *
 * Set MONGODB_URI to enable. Without it the server runs in "ephemeral engine"
 * mode — identical behaviour, no durability.
 */
const permissive = new Schema({ _id: String } as never, { strict: false, versionKey: false, timestamps: false });

const Models = {
  users: mongoose.models.AxiomUser ?? mongoose.model('AxiomUser', permissive, 'users'),
  questions: mongoose.models.AxiomQuestion ?? mongoose.model('AxiomQuestion', permissive, 'questions'),
  exams: mongoose.models.AxiomExam ?? mongoose.model('AxiomExam', permissive, 'exams'),
  responses: mongoose.models.AxiomResponse ?? mongoose.model('AxiomResponse', permissive, 'responses'),
  attempts: mongoose.models.AxiomAttempt ?? mongoose.model('AxiomAttempt', permissive, 'attempts'),
  papers: mongoose.models.AxiomPaper ?? mongoose.model('AxiomPaper', permissive, 'papers'),
  passwordResets:
    mongoose.models.AxiomPasswordReset ??
    mongoose.model('AxiomPasswordReset', permissive, 'password_resets'),
  contactMessages:
    mongoose.models.AxiomContactMessage ??
    mongoose.model('AxiomContactMessage', permissive, 'contact_messages'),
  auditLogs:
    mongoose.models.AxiomAuditLog ?? mongoose.model('AxiomAuditLog', permissive, 'audit_logs'),
  ownerSessions:
    mongoose.models.AxiomOwnerSession ?? mongoose.model('AxiomOwnerSession', permissive, 'owner_sessions')
};

let ready = false;

export function mongoReady(): boolean {
  return ready;
}

export async function initMongo(): Promise<boolean> {
  if (!config.mongoUri) return false;
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 3000 });
    ready = true;
    const [users, questions, exams, responses, attempts, papers, passwordResets, auditLogs, ownerSessions] = await Promise.all([
      Models.users.find().lean(),
      Models.questions.find().lean(),
      Models.exams.find().lean(),
      Models.responses.find().lean(),
      Models.attempts.find().lean(),
      Models.papers.find().lean(),
      Models.passwordResets.find().lean(),
      Models.auditLogs.find().sort({ at: -1 }).limit(2000).lean(),
      Models.ownerSessions.find().lean()
    ]);
    const clean = <T>(rows: Record<string, unknown>[]): T[] =>
      rows.map(({ _id, ...rest }) => ({ id: String(_id), ...rest }) as T);

    if (users.length) store.users = clean(users);
    if (questions.length) store.questions = clean(questions);
    if (exams.length) store.exams = clean(exams);
    if (responses.length) store.responses = clean(responses);
    if (attempts.length) store.attempts = clean(attempts);
    if (papers.length) store.papers = clean(papers);
    if (passwordResets.length) store.passwordResets = clean(passwordResets);
    if (auditLogs.length) {
      const entries = clean<AuditEntry>(auditLogs).sort((a, b) => a.at - b.at);
      store.auditLogs = entries;
      hydrateAudit(entries);
    }

    // Expired reset tokens are useless — drop them on boot.
    const now = Date.now();
    const stale = store.passwordResets.filter((r) => r.expiresAt < now || r.usedAt);
    if (stale.length) {
      store.passwordResets = store.passwordResets.filter((r) => r.expiresAt >= now && !r.usedAt);
      stale.forEach((r) => unpersist('passwordResets', r.id));
    }

    // Owner sign-ins survive a restart until they expire or are signed out.
    const sessions = clean<OwnerSession>(ownerSessions);
    store.ownerSessions = sessions.filter((s) => s.expiresAt > now && !s.revokedAt);
    sessions.filter((s) => s.expiresAt <= now || s.revokedAt).forEach((s) => unpersist('ownerSessions', s.id));
    return true;
  } catch (err) {
    console.warn('[mongo] unavailable — falling back to ephemeral engine:', (err as Error).message);
    ready = false;
    return false;
  }
}

/**
 * Write-through mirror (fire and forget — never blocks a live exam).
 * A field that is `undefined` is removed from the stored document: `$set`
 * alone would leave the old value in MongoDB, and it would come back on the
 * next boot (e.g. a paper still pointing at a deleted session).
 */
export function persist(collection: keyof typeof Models, doc: { id: string } & Record<string, unknown>): void {
  if (!ready) return;
  const { id, update } = toUpdate(doc);
  if (!update) return;
  Models[collection]
    .updateOne({ _id: id }, update, { upsert: true })
    .catch((err: Error) => console.warn('[mongo] persist failed', err.message));
}

function toUpdate(doc: { id: string } & Record<string, unknown>): { id: string; update: Record<string, unknown> | null } {
  const { id, ...rest } = doc;
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) $unset[key] = '';
    else $set[key] = value;
  }
  const update: Record<string, unknown> = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  return { id, update: Object.keys(update).length ? update : null };
}

export function unpersist(collection: keyof typeof Models, id: string): void {
  if (!ready) return;
  Models[collection].deleteOne({ _id: id }).catch(() => undefined);
}

// ── Contact messages for the owner console ────────────────────
/**
 * Only the newest few contact messages are kept in memory (the form needs them
 * for its daily limit), so the owner console reads and writes them in MongoDB
 * directly, and falls back to memory when there is no database.
 */
export interface ContactQuery {
  topic?: string;
  status?: ContactStatus;
  search?: string;
  /** Faculty access requests nobody has decided on yet. */
  facultyPending?: boolean;
  facultyDecision?: 'approved' | 'declined';
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function contactFilter(q: ContactQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (q.topic) filter.topic = q.topic;
  // A message nobody has triaged has no status field at all.
  if (q.status === 'new') filter.status = { $in: [null, 'new'] };
  else if (q.status) filter.status = q.status;
  if (q.facultyPending) {
    filter.topic = 'faculty';
    filter.facultyDecision = { $exists: false };
    if (!q.status) filter.status = { $ne: 'archived' };
  }
  if (q.facultyDecision) filter.facultyDecision = q.facultyDecision;
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: re }, { email: re }, { org: re }, { message: re }];
  }
  return filter;
}

/** Same rules as `contactFilter`, for the in-memory fallback. */
export function contactMatches(m: ContactMessage, q: ContactQuery): boolean {
  const status = m.status ?? 'new';
  if (q.facultyPending && (m.topic !== 'faculty' || m.facultyDecision || (!q.status && status === 'archived'))) return false;
  if (q.facultyDecision && m.facultyDecision !== q.facultyDecision) return false;
  if (q.topic && m.topic !== q.topic) return false;
  if (q.status && status !== q.status) return false;
  if (q.search) {
    const s = q.search.toLowerCase();
    if (![m.name, m.email, m.org, m.message].some((v) => (v ?? '').toLowerCase().includes(s))) return false;
  }
  return true;
}

const asContact = (row: Record<string, unknown>): ContactMessage => {
  const { _id, ...rest } = row;
  return { id: String(_id), ...rest } as unknown as ContactMessage;
};

export async function queryContactMessages(
  q: ContactQuery,
  skip: number,
  limit: number
): Promise<{ items: ContactMessage[]; total: number }> {
  if (!ready) {
    const rows = store.contactMessages.filter((m) => contactMatches(m, q)).sort((a, b) => b.createdAt - a.createdAt);
    return { items: rows.slice(skip, skip + limit), total: rows.length };
  }
  const filter = contactFilter(q);
  const [rows, total] = await Promise.all([
    Models.contactMessages.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Models.contactMessages.countDocuments(filter)
  ]);
  return { items: (rows as Record<string, unknown>[]).map(asContact), total };
}

export async function countContactMessages(q: ContactQuery): Promise<number> {
  if (!ready) return store.contactMessages.filter((m) => contactMatches(m, q)).length;
  return Models.contactMessages.countDocuments(contactFilter(q));
}

export async function findContactMessage(id: string): Promise<ContactMessage | null> {
  if (!ready) return store.contactMessages.find((m) => m.id === id) ?? null;
  const row = await Models.contactMessages.findOne({ _id: id }).lean();
  return row ? asContact(row as Record<string, unknown>) : null;
}

/** Awaited write, so the console can tell the owner when saving failed. */
export async function saveContactMessage(message: ContactMessage): Promise<void> {
  const inMemory = store.contactMessages.find((m) => m.id === message.id);
  if (inMemory) Object.assign(inMemory, message);
  if (!ready) return;
  const { id, update } = toUpdate(message as unknown as { id: string } & Record<string, unknown>);
  if (update) await Models.contactMessages.updateOne({ _id: id }, update, { upsert: true });
}

export async function deleteContactMessage(id: string): Promise<void> {
  store.contactMessages = store.contactMessages.filter((m) => m.id !== id);
  if (!ready) return;
  await Models.contactMessages.deleteOne({ _id: id });
}

/**
 * Every audit entry recorded anywhere in the app is mirrored to MongoDB.
 * Registered here (rather than inside security.ts) to keep that module free of
 * database imports.
 */
setAuditSink((entry: AuditEntry) => {
  store.auditLogs.push(entry);
  if (store.auditLogs.length > 2000) store.auditLogs.splice(0, store.auditLogs.length - 2000);
  persist('auditLogs', entry as unknown as { id: string } & Record<string, unknown>);
});
