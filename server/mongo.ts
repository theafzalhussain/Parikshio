import mongoose, { Schema } from 'mongoose';
import { config } from './config';
import { store } from './store';
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
  papers: mongoose.models.AxiomPaper ?? mongoose.model('AxiomPaper', permissive, 'papers'),
  passwordResets:
    mongoose.models.AxiomPasswordReset ??
    mongoose.model('AxiomPasswordReset', permissive, 'password_resets'),
  auditLogs:
    mongoose.models.AxiomAuditLog ?? mongoose.model('AxiomAuditLog', permissive, 'audit_logs')
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
    const [users, questions, exams, responses, papers, passwordResets, auditLogs] = await Promise.all([
      Models.users.find().lean(),
      Models.questions.find().lean(),
      Models.exams.find().lean(),
      Models.responses.find().lean(),
      Models.papers.find().lean(),
      Models.passwordResets.find().lean(),
      Models.auditLogs.find().sort({ at: -1 }).limit(2000).lean()
    ]);
    const clean = <T>(rows: Record<string, unknown>[]): T[] =>
      rows.map(({ _id, ...rest }) => ({ id: String(_id), ...rest }) as T);

    if (users.length) store.users = clean(users);
    if (questions.length) store.questions = clean(questions);
    if (exams.length) store.exams = clean(exams);
    if (responses.length) store.responses = clean(responses);
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
    return true;
  } catch (err) {
    console.warn('[mongo] unavailable — falling back to ephemeral engine:', (err as Error).message);
    ready = false;
    return false;
  }
}

/** Write-through mirror (fire and forget — never blocks a live exam). */
export function persist(collection: keyof typeof Models, doc: { id: string } & Record<string, unknown>): void {
  if (!ready) return;
  const { id, ...rest } = doc;
  Models[collection]
    .updateOne({ _id: id }, { $set: rest }, { upsert: true })
    .catch((err: Error) => console.warn('[mongo] persist failed', err.message));
}

export function unpersist(collection: keyof typeof Models, id: string): void {
  if (!ready) return;
  Models[collection].deleteOne({ _id: id }).catch(() => undefined);
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
