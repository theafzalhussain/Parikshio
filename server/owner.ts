import crypto from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response as ExpressResponse
} from 'express';
import jwt from 'jsonwebtoken';
import { config, isProd } from './config';
import { burnPasswordCheck, hashPasswordAsync, verifyPasswordAsync } from './auth';
import { cache, cacheKeys } from './cache';
import { contactReference } from './contactRules';
import { isDemoAccountEmail } from './demoAccounts';
import {
  emailEnabled,
  sendFacultyGrantedEmail,
  sendFacultyInviteEmail,
  sendOwnerCodeEmail,
  sendOwnerTestEmail,
  sendPasswordResetEmail
} from './email';
import { deleteExam, endExam } from './engine';
import { forgetAiWork } from './grading';
import {
  countContactMessages,
  deleteContactMessage,
  findContactMessage,
  mongoReady,
  persist,
  queryContactMessages,
  saveContactMessage,
  unpersist,
  type ContactQuery
} from './mongo';
import { ioInstance, userRoom } from './realtime';
import {
  clientIp,
  createRateLimiter,
  createResetToken,
  listAudit,
  recordAudit,
  safeEqual,
  type AuditEntry
} from './security';
import { db, store, uid, type ContactMessage, type OwnerCredential, type OwnerSession, type PasswordReset, type StoredUser } from './store';
import { CONTACT_ROLES, contactTopicLabel, isContactTopic } from '../shared/contact';
import { cleanOrg, ORG_NONE, orgKey } from '../shared/org';
import type {
  GrantResult,
  OwnerAuditRow,
  OwnerContactStatus,
  OwnerExamRow,
  OwnerExamsPage,
  OwnerMe,
  OwnerMessage,
  OwnerMessagesPage,
  OwnerOverview,
  OwnerOrganization,
  OwnerOrganizationsList,
  OwnerRequestsPage,
  OwnerSessionRow,
  OwnerSignIn,
  OwnerSystem,
  OwnerUserDetail,
  OwnerUserRow,
  OwnerUsersPage
} from '../shared/owner';
import type { ExamStatus, Role } from '../shared/types';

/**
 * The owner console API, mounted at /api/owner and used only by the hidden
 * /hq pages.
 *
 * Access is not tied to a Parikshio account. The owner proves control of an
 * address in OWNER_EMAILS with a one-time code sent to that inbox, and gets a
 * short-lived owner session signed with a key derived from JWT_SECRET, so a
 * user token can never pass as an owner token (or the other way round).
 * Registering an account with the owner's address therefore grants nothing.
 */
export const ownerApi = Router();

interface OwnerRequest extends Request {
  owner?: { email: string; sessionId: string };
}

function asyncRoute(
  handler: (req: OwnerRequest, res: ExpressResponse, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req as OwnerRequest, res, next).catch(next);
  };
}

const asPersistable = <T extends { id: string }>(doc: T) => doc as unknown as { id: string } & Record<string, unknown>;

const OWNER_KEY = crypto.createHmac('sha256', config.jwtSecret).update('parikshio:owner-session:v1').digest();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;

const normEmail = (value: unknown) => String(value ?? '').trim().toLowerCase().slice(0, 160);
const cleanText = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isOwnerEmail = (email: string) => config.owner.emails.includes(email);

// Owner data is never cached by a browser or proxy.
ownerApi.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ── sign-in with an emailed code ─────────────────────────────────

interface PendingCode {
  hash: string;
  expiresAt: number;
  attempts: number;
}
/** Codes waiting to be entered, by owner email. A restart simply means asking for a new one. */
const pendingCodes = new Map<string, PendingCode>();

const hashCode = (email: string, code: string) =>
  crypto.createHmac('sha256', OWNER_KEY).update(`${email}:${code}`).digest('hex');

const emailKey = (req: Request) => normEmail((req.body as { email?: unknown } | undefined)?.email) || null;

const codeIpLimiter = createRateLimiter({
  name: 'owner-code:ip',
  windowMs: 15 * 60_000,
  max: 20,
  message: 'Too many code requests from this network. Wait a few minutes and try again.'
});
const codeEmailLimiter = createRateLimiter({
  name: 'owner-code:email',
  windowMs: 15 * 60_000,
  max: 5,
  keyFor: emailKey,
  message: 'A code was sent several times just now. Use the newest email, or wait 15 minutes.'
});
const codeEmailDailyLimiter = createRateLimiter({
  name: 'owner-code:email-day',
  windowMs: DAY_MS,
  max: 20,
  keyFor: emailKey,
  message: 'Too many codes were requested for this address today. Try again tomorrow.'
});
const verifyIpLimiter = createRateLimiter({
  name: 'owner-verify:ip',
  windowMs: 15 * 60_000,
  max: 30,
  message: 'Too many attempts. Wait a few minutes and request a new code.'
});

function consoleOff(res: ExpressResponse) {
  return res.status(503).json({ error: 'The owner console is turned off on this server.', code: 'owner/disabled' });
}

ownerApi.post('/auth/request-code', codeIpLimiter, codeEmailLimiter, codeEmailDailyLimiter, (req: OwnerRequest, res) => {
  if (!config.owner.enabled) return consoleOff(res);
  const email = normEmail(req.body?.email);
  const ip = clientIp(req);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

  const minutes = Math.round(config.owner.codeTtlMs / 60_000);
  // Same reply either way, so this cannot be used to find out who the owner is.
  const reply = {
    ok: true,
    message: `If this is an owner address, a 6-digit code is on its way. It expires in ${minutes} minutes.`
  };
  if (!isOwnerEmail(email)) {
    recordAudit({ action: 'owner.code_refused', actorId: null, actorName: email, detail: 'not an owner address', ip });
    return res.json(reply);
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const now = Date.now();
  // Asking again replaces the previous code.
  pendingCodes.set(email, { hash: hashCode(email, code), expiresAt: now + config.owner.codeTtlMs, attempts: 0 });
  recordAudit({ action: 'owner.code_sent', actorId: null, actorName: email, detail: 'sign-in code issued', ip });

  if (emailEnabled()) {
    // Not awaited: an owner address must not answer measurably slower than any other.
    void sendOwnerCodeEmail({ to: email, code, minutes, ip, requestedAt: now }).then((result) => {
      if (!result.ok) {
        console.warn(`[owner] sign-in code email to ${email} failed: ${result.error}`);
        recordAudit({ action: 'owner.code_email_failed', actorId: null, actorName: email, detail: result.error ?? 'unknown', ip });
      }
    });
    return res.json(reply);
  }
  if (!isProd) {
    console.log(`\n  🔑 Owner sign-in code for ${email}: ${code}\n`);
    return res.json({ ...reply, devCode: code });
  }
  console.warn('[owner] a sign-in code was requested but email is not configured, so it cannot be delivered.');
  return res.json(reply);
});

ownerApi.post('/auth/verify', verifyIpLimiter, (req: OwnerRequest, res) => {
  if (!config.owner.enabled) return consoleOff(res);
  const email = normEmail(req.body?.email);
  const code = String(req.body?.code ?? '').replace(/\D/g, '');
  const ip = clientIp(req);
  const refuse = (detail: string) => {
    recordAudit({ action: 'owner.login_failed', actorId: null, actorName: email || 'unknown', detail, ip });
    return res.status(400).json({ error: 'That code is wrong or has expired. Request a new one.', code: 'owner/bad-code' });
  };

  if (!isOwnerEmail(email) || code.length !== 6) return refuse('not an owner address or malformed code');
  const pending = pendingCodes.get(email);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingCodes.delete(email);
    return refuse('no code or code expired');
  }
  if (!safeEqual(pending.hash, hashCode(email, code))) {
    pending.attempts += 1;
    // A handful of guesses per code: a million possibilities stay out of reach.
    if (pending.attempts >= CODE_MAX_ATTEMPTS) pendingCodes.delete(email);
    return refuse(`wrong code (attempt ${pending.attempts})`);
  }
  pendingCodes.delete(email);
  res.json(openSession(email, req, ip));
});

/** Creates and stores an owner session and returns the sign-in the browser keeps. */
function openSession(email: string, req: Request, ip: string): OwnerSignIn {
  const now = Date.now();
  const session: OwnerSession = {
    id: uid('own_'),
    email,
    createdAt: now,
    expiresAt: now + config.owner.sessionTtlMs,
    lastSeenAt: now,
    ip,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200)
  };
  store.ownerSessions.push(session);
  persist('ownerSessions', asPersistable(session));
  recordAudit({ action: 'owner.login', actorId: null, actorName: email, detail: `owner session ${session.id}`, ip });

  const token = jwt.sign({ sid: session.id, sub: email, scope: 'owner' }, OWNER_KEY, {
    algorithm: 'HS256',
    expiresIn: Math.floor(config.owner.sessionTtlMs / 1000)
  });
  return { token, email, expiresAt: session.expiresAt };
}

// ── sign-in with a password ──────────────────────────────────────

/*
 * No password is written in this code: the repository is public. The owner's
 * password lives only in the database, as a bcrypt hash. On a brand-new
 * database there is none yet; the owner signs in once with an emailed code and
 * sets one in Settings (or the server starts with OWNER_INITIAL_PASSWORD set,
 * which is hashed and saved on first use and can then be removed).
 */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/** The owner's stored credential, or undefined while no password has been set. */
async function credentialFor(email: string): Promise<OwnerCredential | undefined> {
  const existing = store.ownerCredentials.find((c) => c.email === email);
  if (existing) return existing;
  const initial = (process.env.OWNER_INITIAL_PASSWORD ?? '').trim();
  if (initial.length < PASSWORD_MIN) return undefined;
  const credential: OwnerCredential = { id: email, email, passwordHash: await hashPasswordAsync(initial), updatedAt: Date.now() };
  // Two first sign-ins can race while the hash is computed.
  const raced = store.ownerCredentials.find((c) => c.email === email);
  if (raced) return raced;
  store.ownerCredentials.push(credential);
  persist('ownerCredentials', asPersistable(credential));
  return credential;
}

const loginIpLimiter = createRateLimiter({
  name: 'owner-login:ip',
  windowMs: 15 * 60_000,
  max: 15,
  message: 'Too many sign-in attempts from this network. Wait a few minutes and try again.'
});
const loginEmailLimiter = createRateLimiter({
  name: 'owner-login:email',
  windowMs: 15 * 60_000,
  max: 8,
  keyFor: emailKey,
  message: 'Too many wrong passwords for this address. Wait 15 minutes, or sign in with an emailed code.'
});
/** A slow, patient guesser is capped too: at most 30 tries a day for the owner address. */
const loginEmailDailyLimiter = createRateLimiter({
  name: 'owner-login:email-day',
  windowMs: DAY_MS,
  max: 30,
  keyFor: emailKey,
  message: 'Too many sign-in attempts for this address today. Sign in with an emailed code instead.'
});

ownerApi.post('/auth/login', loginIpLimiter, loginEmailLimiter, loginEmailDailyLimiter, asyncRoute(async (req, res) => {
  if (!config.owner.enabled) return consoleOff(res);
  const email = normEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ip = clientIp(req);
  const refuse = (detail: string) => {
    recordAudit({ action: 'owner.login_failed', actorId: null, actorName: email || 'unknown', detail, ip });
    return res.status(400).json({ error: 'Email or password is incorrect.', code: 'owner/bad-password' });
  };

  if (!password || password.length > PASSWORD_MAX) return refuse('missing or oversized password');
  if (!isOwnerEmail(email)) {
    // Do the same work as a real check so the reply time does not reveal the owner address.
    await burnPasswordCheck(password);
    return refuse('not an owner address');
  }
  const credential = await credentialFor(email);
  if (!credential) {
    await burnPasswordCheck(password);
    recordAudit({ action: 'owner.login_failed', actorId: null, actorName: email, detail: 'no password set yet', ip });
    return res.status(400).json({
      error: 'Password sign-in is not set up yet. Use “Email me a code instead”, then set a password in Settings.',
      code: 'owner/no-password'
    });
  }
  if (!(await verifyPasswordAsync(password, credential.passwordHash))) return refuse('wrong password');
  res.json(openSession(email, req, ip));
}));


// ── everything below needs an owner session ──────────────────────

function requireOwner(req: OwnerRequest, res: ExpressResponse, next: NextFunction) {
  if (!config.owner.enabled) return consoleOff(res);
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const signedOut = (error = 'Please sign in to the owner console again.') =>
    res.status(401).json({ error, code: 'owner/session' });
  if (!token) return signedOut();
  try {
    const payload = jwt.verify(token, OWNER_KEY, { algorithms: ['HS256'] }) as { sid?: string; sub?: string; scope?: string };
    if (payload.scope !== 'owner' || !payload.sid) return signedOut();
    const now = Date.now();
    const session = store.ownerSessions.find((s) => s.id === payload.sid);
    if (!session || session.revokedAt || session.expiresAt < now || session.email !== payload.sub) return signedOut();
    if (!isOwnerEmail(session.email)) return signedOut('This address is no longer an owner address.');
    if (now - session.lastSeenAt > 5 * 60_000) {
      session.lastSeenAt = now;
      persist('ownerSessions', asPersistable(session));
    }
    req.owner = { email: session.email, sessionId: session.id };
    return next();
  } catch {
    return signedOut();
  }
}

ownerApi.use(requireOwner);

function audit(req: OwnerRequest, action: string, detail: string) {
  recordAudit({ action: `owner.${action}`, actorId: null, actorName: req.owner!.email, detail: detail.slice(0, 480), ip: clientIp(req) });
}

ownerApi.get('/auth/me', (req: OwnerRequest, res) => {
  const session = store.ownerSessions.find((s) => s.id === req.owner!.sessionId)!;
  const body: OwnerMe = { email: session.email, sessionId: session.id, expiresAt: session.expiresAt };
  res.json(body);
});

function revokeSession(session: OwnerSession) {
  session.revokedAt = Date.now();
  store.ownerSessions = store.ownerSessions.filter((s) => s.id !== session.id);
  unpersist('ownerSessions', session.id);
}

const passwordChangeLimiter = createRateLimiter({
  name: 'owner-password-change',
  windowMs: 15 * 60_000,
  max: 10,
  message: 'Too many password change attempts. Wait a few minutes and try again.'
});

/** Whether the owner can sign in with a password yet (Settings shows "set" or "change"). */
ownerApi.get('/auth/password', asyncRoute(async (req, res) => {
  const credential = await credentialFor(req.owner!.email);
  res.json({ set: !!credential, updatedAt: credential?.updatedAt ?? null });
}));

ownerApi.post('/auth/change-password', passwordChangeLimiter, asyncRoute(async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  const existing = await credentialFor(req.owner!.email);

  // With no password yet (signed in by emailed code), the first one is set directly.
  if (existing && (!currentPassword || !(await verifyPasswordAsync(currentPassword, existing.passwordHash)))) {
    audit(req, 'password_change_failed', 'wrong current password');
    return res.status(400).json({ error: 'The current password is incorrect.' });
  }
  if (newPassword.length < PASSWORD_MIN) {
    return res.status(400).json({ error: `The new password needs at least ${PASSWORD_MIN} characters.` });
  }
  if (newPassword.length > PASSWORD_MAX) {
    return res.status(400).json({ error: `The new password can be at most ${PASSWORD_MAX} characters.` });
  }
  if (existing && newPassword === currentPassword) {
    return res.status(400).json({ error: 'Choose a password different from the current one.' });
  }

  const passwordHash = await hashPasswordAsync(newPassword);
  const email = req.owner!.email;
  const credential: OwnerCredential = existing ?? { id: email, email, passwordHash, updatedAt: Date.now() };
  if (!existing) store.ownerCredentials.push(credential);
  credential.passwordHash = passwordHash;
  credential.updatedAt = Date.now();
  credential.custom = true;
  persist('ownerCredentials', asPersistable(credential));

  // Every other device must sign in again with the new password.
  const others = store.ownerSessions.filter((s) => s.id !== req.owner!.sessionId);
  others.forEach(revokeSession);
  audit(req, 'password_changed', `owner password ${existing ? 'changed' : 'set'}; ${others.length} other sign-in(s) ended`);
  res.json({ ok: true, signedOutOthers: others.length, updatedAt: credential.updatedAt });
}));

ownerApi.post('/auth/logout', (req: OwnerRequest, res) => {
  const session = store.ownerSessions.find((s) => s.id === req.owner!.sessionId);
  if (session) revokeSession(session);
  audit(req, 'logout', `owner session ${req.owner!.sessionId}`);
  res.json({ ok: true });
});

ownerApi.get('/sessions', (req: OwnerRequest, res) => {
  const now = Date.now();
  const items: OwnerSessionRow[] = store.ownerSessions
    .filter((s) => !s.revokedAt && s.expiresAt > now)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((s) => ({
      id: s.id,
      email: s.email,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      lastSeenAt: s.lastSeenAt,
      ip: s.ip,
      userAgent: s.userAgent,
      current: s.id === req.owner!.sessionId
    }));
  res.json({ items });
});

ownerApi.post('/sessions/revoke-others', (req: OwnerRequest, res) => {
  const others = store.ownerSessions.filter((s) => s.id !== req.owner!.sessionId);
  others.forEach(revokeSession);
  audit(req, 'sessions_revoked', `${others.length} other owner session(s) signed out`);
  res.json({ ok: true, revoked: others.length });
});

ownerApi.post('/sessions/:id/revoke', (req: OwnerRequest, res) => {
  const session = store.ownerSessions.find((s) => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'That sign-in has already ended.' });
  revokeSession(session);
  audit(req, 'sessions_revoked', `owner session ${session.id} (${session.email})`);
  res.json({ ok: true });
});

// ── shared helpers ───────────────────────────────────────────────

function paging(query: Request['query'], defaultSize = 25) {
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(100, Math.max(5, Math.trunc(Number(query.pageSize) || defaultSize)));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

const queryText = (value: unknown, max = 80) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

interface UserStats {
  answers: Map<string, number>;
  points: Map<string, number>;
  joined: Map<string, Set<string>>;
  sessionsCreated: Map<string, number>;
  questions: Map<string, number>;
}

/** One pass over answers, sessions and questions instead of one per user. */
function userStats(): UserStats {
  const stats: UserStats = { answers: new Map(), points: new Map(), joined: new Map(), sessionsCreated: new Map(), questions: new Map() };
  for (const r of store.responses) {
    stats.answers.set(r.studentId, (stats.answers.get(r.studentId) ?? 0) + 1);
    stats.points.set(r.studentId, (stats.points.get(r.studentId) ?? 0) + (r.awarded ?? 0));
    let joined = stats.joined.get(r.studentId);
    if (!joined) stats.joined.set(r.studentId, (joined = new Set()));
    joined.add(r.examId);
  }
  for (const e of store.exams) stats.sessionsCreated.set(e.adminId, (stats.sessionsCreated.get(e.adminId) ?? 0) + 1);
  for (const q of store.questions) stats.questions.set(q.createdBy, (stats.questions.get(q.createdBy) ?? 0) + 1);
  return stats;
}

function userRow(u: StoredUser, stats: UserStats): OwnerUserRow {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    org: u.org,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt ?? null,
    google: !!u.googleId,
    hasPassword: !!u.passwordHash,
    emailVerified: !!u.emailVerified,
    suspended: !!u.suspended,
    invitePending: u.role === 'admin' && !u.passwordHash && !u.googleId && !!u.invitedAt,
    answers: stats.answers.get(u.id) ?? 0,
    sessionsJoined: stats.joined.get(u.id)?.size ?? 0,
    points: Math.round((stats.points.get(u.id) ?? 0) * 10) / 10,
    sessionsCreated: stats.sessionsCreated.get(u.id) ?? 0,
    questionsAuthored: stats.questions.get(u.id) ?? 0
  };
}

const auditRow = (a: AuditEntry): OwnerAuditRow => ({
  id: a.id,
  action: a.action,
  actorId: a.actorId,
  actorName: a.actorName,
  detail: a.detail,
  ip: a.ip,
  at: a.at
});

function messageRow(m: ContactMessage): OwnerMessage {
  const account = db.userByEmail(m.email);
  return {
    id: m.id,
    reference: contactReference(m.id),
    topic: m.topic,
    topicLabel: isContactTopic(m.topic) ? contactTopicLabel(m.topic) : 'Message',
    role: m.role,
    roleLabel: CONTACT_ROLES.find((r) => r.key === m.role)?.label ?? 'Other',
    name: m.name,
    email: m.email,
    org: m.org ?? '',
    message: m.message,
    rating: m.rating ?? null,
    createdAt: m.createdAt,
    delivered: !!m.delivered,
    confirmationSent: !!m.confirmationSent,
    status: (m.status ?? 'new') as OwnerContactStatus,
    note: m.note ?? '',
    resolvedAt: m.resolvedAt ?? null,
    facultyDecision: m.facultyDecision ?? null,
    grantedUserId: m.grantedUserId ?? null,
    account: account ? { id: account.id, name: account.name, role: account.role, suspended: !!account.suspended } : null,
    sentWhileLoggedInAs: m.userId && m.userRole ? { id: m.userId, role: m.userRole } : null
  };
}

/** Where links in emails point: the public site when APP_URL is set, else this server. */
function publicBase(req: Request): string {
  return config.appBaseUrl || `${req.protocol}://${req.get('host') ?? `localhost:${config.port}`}`;
}

/**
 * A single-use "choose a password" link, the same token the reset flow uses.
 * Any older unused link for the account stops working.
 */
function passwordLink(user: StoredUser, ttlMs: number, req: OwnerRequest): string {
  store.passwordResets
    .filter((r) => r.userId === user.id && !r.usedAt)
    .forEach((r) => {
      r.usedAt = Date.now();
      persist('passwordResets', asPersistable(r));
    });
  const { token, tokenHash } = createResetToken();
  const record: PasswordReset = {
    id: uid('prs_'),
    userId: user.id,
    tokenHash,
    expiresAt: Date.now() + ttlMs,
    requestedIp: clientIp(req),
    createdAt: Date.now()
  };
  store.passwordResets.push(record);
  persist('passwordResets', asPersistable(record));
  return `/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
}

/** Ends every login of an account at once: open sockets drop, tokens stop working. */
function endUserSessions(user: StoredUser) {
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  ioInstance()?.in(userRoom(user.id)).disconnectSockets(true);
}

function validEmailFor(email: string, exceptUserId?: string): string | null {
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address.';
  if (isProd && isDemoAccountEmail(email)) return 'Demo addresses cannot be used on the live site.';
  const taken = db.userByEmail(email);
  if (taken && taken.id !== exceptUserId) return 'Another account already uses this email.';
  return null;
}

// ── overview ─────────────────────────────────────────────────────

ownerApi.get(
  '/overview',
  asyncRoute(async (_req, res) => {
    const now = Date.now();
    const weekAgo = now - 7 * DAY_MS;
    const stats = userStats();
    const users = store.users;
    const [messagesTotal, messagesNew, facultyPending, recent] = await Promise.all([
      countContactMessages({}),
      countContactMessages({ status: 'new' }),
      countContactMessages({ facultyPending: true }),
      queryContactMessages({}, 0, 5)
    ]);
    const body: OwnerOverview = {
      users: {
        total: users.length,
        students: users.filter((u) => u.role === 'student').length,
        faculty: users.filter((u) => u.role === 'admin').length,
        suspended: users.filter((u) => u.suspended).length,
        newThisWeek: users.filter((u) => u.createdAt >= weekAgo).length,
        activeThisWeek: users.filter((u) => (u.lastLoginAt ?? 0) >= weekAgo).length
      },
      exams: {
        total: store.exams.length,
        live: store.exams.filter((e) => e.status === 'live').length,
        draft: store.exams.filter((e) => e.status === 'draft').length,
        ended: store.exams.filter((e) => e.status === 'ended').length
      },
      content: {
        questions: store.questions.length,
        papers: store.papers.length,
        responses: store.responses.length,
        responsesToday: store.responses.filter((r) => r.submittedAt >= now - DAY_MS).length
      },
      messages: { total: messagesTotal, new: messagesNew, facultyPending },
      recentUsers: [...users]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 6)
        .map((u) => userRow(u, stats)),
      recentMessages: recent.items.map(messageRow),
      recentActivity: listAudit(10).map(auditRow),
      health: { mongo: mongoReady(), email: emailEnabled(), ai: config.gemini.enabled }
    };
    res.json(body);
  })
);

// ── users ────────────────────────────────────────────────────────

/** Every organisation accounts gave, grouped so spelling variants count once. */
function organizations(users: StoredUser[]): OwnerOrganizationsList {
  const groups = new Map<string, { spellings: Map<string, number>; total: number; students: number; faculty: number; lastJoinedAt: number }>();
  const unset = { total: 0, students: 0, faculty: 0 };
  for (const u of users) {
    const key = orgKey(u.org);
    if (!key) {
      unset.total += 1;
      if (u.role === 'admin') unset.faculty += 1;
      else unset.students += 1;
      continue;
    }
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { spellings: new Map(), total: 0, students: 0, faculty: 0, lastJoinedAt: 0 }));
    const spelling = cleanOrg(u.org);
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
    group.total += 1;
    if (u.role === 'admin') group.faculty += 1;
    else group.students += 1;
    group.lastJoinedAt = Math.max(group.lastJoinedAt, u.createdAt);
  }
  const items: OwnerOrganization[] = [...groups.entries()].map(([key, g]) => {
    // The spelling most accounts used; ties go to the one with more capitals ("VDC" over "vdc").
    const ranked = [...g.spellings.entries()].sort(
      (a, b) => b[1] - a[1] || (b[0].match(/\p{Lu}/gu)?.length ?? 0) - (a[0].match(/\p{Lu}/gu)?.length ?? 0) || a[0].localeCompare(b[0])
    );
    return {
      key,
      name: ranked[0]![0],
      variants: ranked.slice(1).map(([s]) => s),
      total: g.total,
      students: g.students,
      faculty: g.faculty,
      lastJoinedAt: g.lastJoinedAt
    };
  });
  items.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { items, unset };
}

ownerApi.get('/organizations', (req: OwnerRequest, res) => {
  const search = orgKey(queryText(req.query.search, 120));
  const list = organizations(store.users);
  if (search) {
    list.items = list.items.filter((o) => o.key.includes(search) || o.variants.some((v) => orgKey(v).includes(search)));
  }
  res.json(list);
});

ownerApi.get('/users', (req: OwnerRequest, res) => {
  const { page, pageSize, skip } = paging(req.query);
  const search = queryText(req.query.search).toLowerCase();
  const role = req.query.role === 'student' || req.query.role === 'admin' ? (req.query.role as Role) : null;
  const state = queryText(req.query.state);
  const sort = queryText(req.query.sort) || 'newest';
  // An organisation key from /organizations; ORG_NONE means "no organisation given".
  const org = typeof req.query.org === 'string' ? (req.query.org === ORG_NONE ? ORG_NONE : orgKey(req.query.org)) : null;
  const stats = userStats();

  const all = store.users;
  let rows = all.filter((u) => {
    if (role && u.role !== role) return false;
    if (state === 'suspended' && !u.suspended) return false;
    if (state === 'active' && u.suspended) return false;
    if (state === 'invited' && !(u.role === 'admin' && !u.passwordHash && !u.googleId && u.invitedAt)) return false;
    if (org !== null && orgKey(u.org) !== (org === ORG_NONE ? '' : org)) return false;
    if (search && ![u.name, u.email, u.org].some((v) => (v ?? '').toLowerCase().includes(search))) return false;
    return true;
  });
  rows = [...rows].sort((a, b) => {
    if (sort === 'oldest') return a.createdAt - b.createdAt;
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'lastLogin') return (b.lastLoginAt ?? 0) - (a.lastLoginAt ?? 0);
    return b.createdAt - a.createdAt;
  });

  const body: OwnerUsersPage = {
    items: rows.slice(skip, skip + pageSize).map((u) => userRow(u, stats)),
    total: rows.length,
    page,
    pageSize,
    counts: {
      all: all.length,
      students: all.filter((u) => u.role === 'student').length,
      faculty: all.filter((u) => u.role === 'admin').length,
      suspended: all.filter((u) => u.suspended).length,
      invited: all.filter((u) => u.role === 'admin' && !u.passwordHash && !u.googleId && u.invitedAt).length,
      organizations: new Set(all.map((u) => orgKey(u.org)).filter(Boolean)).size
    }
  };
  res.json(body);
});

ownerApi.get('/users/:id', (req: OwnerRequest, res) => {
  const user = db.userById(req.params.id);
  if (!user) return res.status(404).json({ error: 'That account no longer exists.' });
  const stats = userStats();
  const examById = new Map(store.exams.map((e) => [e.id, e]));
  const recentAnswers = store.responses
    .filter((r) => r.studentId === user.id)
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .slice(0, 12)
    .map((r) => ({
      id: r.id,
      examTitle: examById.get(r.examId)?.title ?? 'Deleted session',
      examCode: examById.get(r.examId)?.code ?? '—',
      submittedAt: r.submittedAt,
      grade: r.grade,
      awarded: r.awarded
    }));
  const exams = store.exams
    .filter((e) => e.adminId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
    .map((e) => ({
      id: e.id,
      code: e.code,
      title: e.title,
      status: e.status,
      createdAt: e.createdAt,
      responses: store.responses.filter((r) => r.examId === e.id).length
    }));
  const email = user.email.toLowerCase();
  const activity = listAudit(2000)
    .filter((a) => a.actorId === user.id || a.actorName.toLowerCase() === email || a.detail.toLowerCase().includes(email))
    .slice(0, 25)
    .map(auditRow);
  const body: OwnerUserDetail = { ...userRow(user, stats), recentAnswers, exams, activity };
  res.json(body);
});

ownerApi.patch('/users/:id', (req: OwnerRequest, res) => {
  const user = db.userById(req.params.id);
  if (!user) return res.status(404).json({ error: 'That account no longer exists.' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const changes: string[] = [];
  let endSessions = false;

  if (body.name !== undefined) {
    const name = cleanText(body.name, 80);
    if (name.length < 2) return res.status(400).json({ error: 'The name needs at least 2 characters.' });
    if (name !== user.name) {
      changes.push(`name "${user.name}" → "${name}"`);
      user.name = name;
    }
  }
  if (body.org !== undefined) {
    const org = cleanText(body.org, 120);
    if (org !== user.org) {
      changes.push(`institute "${user.org}" → "${org}"`);
      user.org = org;
    }
  }
  if (body.email !== undefined) {
    const email = normEmail(body.email);
    if (email !== user.email) {
      const problem = validEmailFor(email, user.id);
      if (problem) return res.status(400).json({ error: problem });
      changes.push(`email ${user.email} → ${email}`);
      user.email = email;
      // The new address has not been confirmed by its owner.
      user.emailVerified = false;
    }
  }
  if (body.role !== undefined) {
    if (body.role !== 'student' && body.role !== 'admin') return res.status(400).json({ error: 'Role must be student or faculty.' });
    if (body.role !== user.role) {
      changes.push(`role ${user.role === 'admin' ? 'faculty' : 'student'} → ${body.role === 'admin' ? 'faculty' : 'student'}`);
      user.role = body.role;
      // A fresh login picks up the new role everywhere.
      endSessions = true;
    }
  }
  if (body.suspended !== undefined) {
    const suspend = body.suspended === true;
    if (suspend !== !!user.suspended) {
      changes.push(suspend ? 'suspended' : 'reinstated');
      if (suspend) {
        user.suspended = true;
        user.suspendedAt = Date.now();
        endSessions = true;
      } else {
        // `undefined` so persist() removes the fields from MongoDB.
        user.suspended = undefined;
        user.suspendedAt = undefined;
      }
    }
  }

  if (!changes.length) return res.json({ ok: true, user: userRow(user, userStats()), changed: false });
  if (endSessions) endUserSessions(user);
  persist('users', asPersistable(user));
  audit(req, 'user_updated', `${user.email}: ${changes.join('; ')}`);
  res.json({ ok: true, user: userRow(user, userStats()), changed: true });
});

ownerApi.post(
  '/users/:id/reset-link',
  asyncRoute(async (req, res) => {
    const user = db.userById(req.params.id);
    if (!user) return res.status(404).json({ error: 'That account no longer exists.' });
    if (user.suspended) return res.status(400).json({ error: 'Reinstate the account before sending a reset link.' });
    const link = passwordLink(user, config.passwordResetTtlMs, req);
    let emailSent = false;
    if (emailEnabled()) {
      const result = await sendPasswordResetEmail(user.email, user.name, `${publicBase(req)}${link}`);
      emailSent = result.ok;
      if (!result.ok) console.warn(`[owner] reset email to ${user.email} failed: ${result.error}`);
    }
    audit(req, 'reset_link_sent', `${user.email} (email ${emailSent ? 'sent' : 'not sent'})`);
    res.json({ ok: true, emailSent, ...(!isProd && !emailEnabled() ? { devLink: link } : {}) });
  })
);

ownerApi.post('/users/:id/sign-out', (req: OwnerRequest, res) => {
  const user = db.userById(req.params.id);
  if (!user) return res.status(404).json({ error: 'That account no longer exists.' });
  endUserSessions(user);
  persist('users', asPersistable(user));
  audit(req, 'user_signed_out', user.email);
  res.json({ ok: true });
});

/**
 * Deleting an account removes the person and what they wrote as a student
 * (answers and set timers), as the privacy policy promises. A faculty
 * member's sessions and questions stay, because students' results live in them.
 */
ownerApi.delete('/users/:id', (req: OwnerRequest, res) => {
  const user = db.userById(req.params.id);
  if (!user) return res.status(404).json({ error: 'That account no longer exists.' });
  if (normEmail(req.body?.confirm) !== user.email.toLowerCase()) {
    return res.status(400).json({ error: 'Type the account email exactly to confirm.' });
  }

  const responses = store.responses.filter((r) => r.studentId === user.id);
  const attempts = store.attempts.filter((a) => a.studentId === user.id);
  const touchedExams = new Set(responses.map((r) => r.examId));
  store.responses = store.responses.filter((r) => r.studentId !== user.id);
  store.attempts = store.attempts.filter((a) => a.studentId !== user.id);
  forgetAiWork(new Set(responses.map((r) => r.id)));
  responses.forEach((r) => unpersist('responses', r.id));
  attempts.forEach((a) => unpersist('attempts', a.id));
  touchedExams.forEach((examId) => void cache.delPrefix(cacheKeys.examPrefix(examId)));

  const resets = store.passwordResets.filter((r) => r.userId === user.id);
  store.passwordResets = store.passwordResets.filter((r) => r.userId !== user.id);
  resets.forEach((r) => unpersist('passwordResets', r.id));

  ioInstance()?.in(userRoom(user.id)).disconnectSockets(true);
  store.users = store.users.filter((u) => u.id !== user.id);
  unpersist('users', user.id);
  audit(
    req,
    'user_deleted',
    `${user.email} (${user.role === 'admin' ? 'faculty' : 'student'}; ${responses.length} answers removed)`
  );
  res.json({ ok: true, removedAnswers: responses.length });
});

// ── faculty access ───────────────────────────────────────────────

async function grantFaculty(
  input: { email: string; name: string; org: string },
  req: OwnerRequest
): Promise<GrantResult | { error: string }> {
  const email = normEmail(input.email);
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };
  if (isProd && isDemoAccountEmail(email)) return { error: 'Demo addresses cannot be used on the live site.' };
  const base = publicBase(req);
  const loginUrl = `${base}/login?role=faculty`;
  const existing = db.userByEmail(email);

  // An account already exists: raise it to faculty (or re-send a pending invite).
  if (existing) {
    if (existing.suspended) return { error: 'This account is suspended. Reinstate it first.' };
    const invitePending = existing.role === 'admin' && !existing.passwordHash && !existing.googleId;
    if (existing.role === 'admin' && !invitePending) {
      return { user: userRow(existing, userStats()), created: false, alreadyFaculty: true, emailSent: false };
    }
    let emailSent = false;
    let devLink: string | undefined;
    if (invitePending) {
      const link = passwordLink(existing, config.owner.inviteTtlMs, req);
      if (emailEnabled()) {
        const result = await sendFacultyInviteEmail({
          to: existing.email,
          name: existing.name,
          setPasswordUrl: `${base}${link}`,
          loginUrl,
          days: Math.round(config.owner.inviteTtlMs / DAY_MS)
        });
        emailSent = result.ok;
      } else if (!isProd) devLink = link;
      audit(req, 'faculty_invited', `${existing.email} (invite re-sent; email ${emailSent ? 'sent' : 'not sent'})`);
      return { user: userRow(existing, userStats()), created: false, alreadyFaculty: true, emailSent, devLink };
    }
    existing.role = 'admin';
    endUserSessions(existing);
    persist('users', asPersistable(existing));
    if (emailEnabled()) {
      const result = await sendFacultyGrantedEmail({ to: existing.email, name: existing.name, loginUrl });
      emailSent = result.ok;
    }
    audit(req, 'faculty_granted', `${existing.email} (existing account; email ${emailSent ? 'sent' : 'not sent'})`);
    return { user: userRow(existing, userStats()), created: false, alreadyFaculty: false, emailSent };
  }

  // No account yet: create a faculty account and invite them to choose a password.
  const name = cleanText(input.name, 80) || email.split('@')[0]!;
  const user: StoredUser = {
    id: uid('usr_'),
    name: name.length >= 2 ? name : email.split('@')[0]!,
    email,
    role: 'admin',
    org: cleanText(input.org, 120),
    passwordHash: '',
    createdAt: Date.now(),
    emailVerified: false,
    tokenVersion: 0,
    invitedAt: Date.now(),
    invitedBy: req.owner!.email
  };
  store.users.push(user);
  persist('users', asPersistable(user));
  const link = passwordLink(user, config.owner.inviteTtlMs, req);
  let emailSent = false;
  if (emailEnabled()) {
    const result = await sendFacultyInviteEmail({
      to: user.email,
      name: user.name,
      setPasswordUrl: `${base}${link}`,
      loginUrl,
      days: Math.round(config.owner.inviteTtlMs / DAY_MS)
    });
    emailSent = result.ok;
    if (!result.ok) console.warn(`[owner] faculty invite to ${user.email} failed: ${result.error}`);
  }
  audit(req, 'faculty_invited', `${user.email} (new account; email ${emailSent ? 'sent' : 'not sent'})`);
  return {
    user: userRow(user, userStats()),
    created: true,
    alreadyFaculty: false,
    emailSent,
    ...(!isProd && !emailEnabled() ? { devLink: link } : {})
  };
}

ownerApi.post(
  '/faculty/grant',
  asyncRoute(async (req, res) => {
    const result = await grantFaculty(
      { email: String(req.body?.email ?? ''), name: String(req.body?.name ?? ''), org: String(req.body?.org ?? '') },
      req
    );
    if ('error' in result) return res.status(400).json({ error: result.error });
    res.json(result);
  })
);

ownerApi.get(
  '/requests',
  asyncRoute(async (req, res) => {
    const { page, pageSize, skip } = paging(req.query, 20);
    const state = queryText(req.query.state) || 'pending';
    const search = queryText(req.query.search);
    const query: ContactQuery = { topic: 'faculty', ...(search ? { search } : {}) };
    if (state === 'pending') query.facultyPending = true;
    else if (state === 'approved' || state === 'declined') query.facultyDecision = state;
    const [list, pending, approved, declined] = await Promise.all([
      queryContactMessages(query, skip, pageSize),
      countContactMessages({ facultyPending: true }),
      countContactMessages({ topic: 'faculty', facultyDecision: 'approved' }),
      countContactMessages({ topic: 'faculty', facultyDecision: 'declined' })
    ]);
    const body: OwnerRequestsPage = {
      items: list.items.map(messageRow),
      total: list.total,
      page,
      pageSize,
      counts: { pending, approved, declined }
    };
    res.json(body);
  })
);

ownerApi.post(
  '/requests/:id/approve',
  asyncRoute(async (req, res) => {
    const message = await findContactMessage(req.params.id);
    if (!message || message.topic !== 'faculty') return res.status(404).json({ error: 'That request no longer exists.' });
    // Always the address that asked; the invite link then proves they control it.
    const result = await grantFaculty({ email: message.email, name: message.name, org: message.org }, req);
    if ('error' in result) return res.status(400).json({ error: result.error });
    message.facultyDecision = 'approved';
    message.status = 'done';
    message.resolvedAt = Date.now();
    message.grantedUserId = result.user.id;
    await saveContactMessage(message);
    res.json({ ...result, request: messageRow(message) });
  })
);

ownerApi.post(
  '/requests/:id/decline',
  asyncRoute(async (req, res) => {
    const message = await findContactMessage(req.params.id);
    if (!message || message.topic !== 'faculty') return res.status(404).json({ error: 'That request no longer exists.' });
    message.facultyDecision = 'declined';
    message.status = 'done';
    message.resolvedAt = Date.now();
    await saveContactMessage(message);
    audit(req, 'faculty_declined', `${message.email} (${contactReference(message.id)})`);
    res.json({ ok: true, request: messageRow(message) });
  })
);

// ── contact messages ─────────────────────────────────────────────

const STATUSES: OwnerContactStatus[] = ['new', 'done', 'archived'];

ownerApi.get(
  '/messages',
  asyncRoute(async (req, res) => {
    const { page, pageSize, skip } = paging(req.query, 20);
    const topic = queryText(req.query.topic);
    const status = queryText(req.query.status) as OwnerContactStatus;
    const search = queryText(req.query.search);
    const query: ContactQuery = {
      ...(isContactTopic(topic) ? { topic } : {}),
      ...(STATUSES.includes(status) ? { status } : {}),
      ...(search ? { search } : {})
    };
    const scope: ContactQuery = isContactTopic(topic) ? { topic } : {};
    const [list, all, fresh, done, archived] = await Promise.all([
      queryContactMessages(query, skip, pageSize),
      countContactMessages(scope),
      countContactMessages({ ...scope, status: 'new' }),
      countContactMessages({ ...scope, status: 'done' }),
      countContactMessages({ ...scope, status: 'archived' })
    ]);
    const body: OwnerMessagesPage = {
      items: list.items.map(messageRow),
      total: list.total,
      page,
      pageSize,
      counts: { all, new: fresh, done, archived }
    };
    res.json(body);
  })
);

ownerApi.patch(
  '/messages/:id',
  asyncRoute(async (req, res) => {
    const message = await findContactMessage(req.params.id);
    if (!message) return res.status(404).json({ error: 'That message no longer exists.' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const changes: string[] = [];
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as OwnerContactStatus)) return res.status(400).json({ error: 'Unknown status.' });
      const next = body.status as OwnerContactStatus;
      if (next !== (message.status ?? 'new')) {
        changes.push(`status → ${next}`);
        message.status = next;
        message.resolvedAt = next === 'new' ? undefined : Date.now();
      }
    }
    if (body.note !== undefined) {
      const note = String(body.note ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
      if (note !== (message.note ?? '')) {
        changes.push('note updated');
        message.note = note || undefined;
      }
    }
    if (body.reopenDecision === true && message.facultyDecision) {
      changes.push(`faculty decision "${message.facultyDecision}" reopened`);
      message.facultyDecision = undefined;
      message.status = 'new';
      message.resolvedAt = undefined;
    }
    if (changes.length) {
      await saveContactMessage(message);
      audit(req, 'message_updated', `${contactReference(message.id)} from ${message.email}: ${changes.join('; ')}`);
    }
    res.json({ ok: true, message: messageRow(message) });
  })
);

ownerApi.delete(
  '/messages/:id',
  asyncRoute(async (req, res) => {
    const message = await findContactMessage(req.params.id);
    if (!message) return res.status(404).json({ error: 'That message no longer exists.' });
    await deleteContactMessage(message.id);
    audit(req, 'message_deleted', `${contactReference(message.id)} from ${message.email}`);
    res.json({ ok: true });
  })
);

// ── sessions (exams) ─────────────────────────────────────────────

const EXAM_STATUSES: ExamStatus[] = ['live', 'draft', 'ended'];

ownerApi.get('/exams', (req: OwnerRequest, res) => {
  const { page, pageSize, skip } = paging(req.query, 20);
  const status = queryText(req.query.status) as ExamStatus;
  const search = queryText(req.query.search).toLowerCase();
  const answers = new Map<string, { responses: number; students: Set<string> }>();
  for (const r of store.responses) {
    let row = answers.get(r.examId);
    if (!row) answers.set(r.examId, (row = { responses: 0, students: new Set() }));
    row.responses += 1;
    row.students.add(r.studentId);
  }
  const rows = db
    .exams()
    .filter((e) => (EXAM_STATUSES.includes(status) ? e.status === status : true))
    .filter((e) => !search || [e.title, e.code, e.subject, e.adminName].some((v) => (v ?? '').toLowerCase().includes(search)))
    .sort((a, b) => (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1) || b.createdAt - a.createdAt);
  const items: OwnerExamRow[] = rows.slice(skip, skip + pageSize).map((e) => ({
    id: e.id,
    code: e.code,
    title: e.title,
    subject: e.subject,
    status: e.status,
    adminId: e.adminId,
    adminName: db.userById(e.adminId)?.name ?? e.adminName,
    createdAt: e.createdAt,
    endedAt: e.endedAt ?? null,
    questions: e.questionIds.length,
    participants: answers.get(e.id)?.students.size ?? 0,
    responses: answers.get(e.id)?.responses ?? 0
  }));
  const body: OwnerExamsPage = {
    items,
    total: rows.length,
    page,
    pageSize,
    counts: {
      all: store.exams.length,
      live: store.exams.filter((e) => e.status === 'live').length,
      draft: store.exams.filter((e) => e.status === 'draft').length,
      ended: store.exams.filter((e) => e.status === 'ended').length
    }
  };
  res.json(body);
});

ownerApi.post('/exams/:id/end', (req: OwnerRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'That session no longer exists.' });
  if (exam.status === 'ended') return res.json({ ok: true, alreadyEnded: true });
  endExam(exam);
  audit(req, 'exam_ended', `${exam.code} "${exam.title}"`);
  res.json({ ok: true });
});

ownerApi.delete('/exams/:id', (req: OwnerRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'That session no longer exists.' });
  const summary = deleteExam(exam);
  audit(req, 'exam_deleted', `${summary.code} "${summary.title}" (${summary.responses} answers)`);
  res.json({ ok: true, deleted: summary });
});

// ── activity log ─────────────────────────────────────────────────

const AUDIT_KINDS = ['owner', 'auth', 'contact', 'exams', 'security'];

ownerApi.get('/audit', (req: OwnerRequest, res) => {
  const { page, pageSize, skip } = paging(req.query, 50);
  const kind = queryText(req.query.kind);
  const search = queryText(req.query.search).toLowerCase();
  const rows = listAudit(2000).filter((a) => {
    if (AUDIT_KINDS.includes(kind) && !a.action.startsWith(`${kind}.`)) return false;
    if (search && ![a.action, a.actorName, a.detail, a.ip].some((v) => (v ?? '').toLowerCase().includes(search))) return false;
    return true;
  });
  res.json({ items: rows.slice(skip, skip + pageSize).map(auditRow), total: rows.length, page, pageSize });
});

// ── system ───────────────────────────────────────────────────────

ownerApi.get('/system', (_req: OwnerRequest, res) => {
  const body: OwnerSystem = {
    environment: config.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    bootedAt: store.bootedAt,
    commit: (process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 12) || null,
    mongo: mongoReady() ? 'connected' : 'ephemeral',
    redis: cache.stats().status,
    email: {
      enabled: emailEnabled(),
      senderName: config.brevo.senderName,
      senderEmail: config.brevo.senderEmail,
      inbox: config.contact.inbox
    },
    ai: { enabled: config.gemini.enabled, models: config.gemini.enabled ? config.gemini.models : [] },
    googleSignIn: config.firebase.enabled,
    classroom: config.googleClassroom.enabled,
    appUrl: config.appBaseUrl,
    allowedOrigins: config.allowedOrigins,
    ownerEmails: config.owner.emails
  };
  res.json(body);
});

const testEmailLimiter = createRateLimiter({
  name: 'owner-test-email',
  windowMs: 60 * 60_000,
  max: 10,
  message: 'Several test emails were sent just now. Try again later.'
});

ownerApi.post(
  '/system/test-email',
  testEmailLimiter,
  asyncRoute(async (req, res) => {
    if (!emailEnabled()) return res.status(400).json({ error: 'Email is not configured on this server (BREVO_API_KEY / BREVO_SENDER_EMAIL).' });
    // Only ever to the signed-in owner, so this cannot be used to mail anyone else.
    const result = await sendOwnerTestEmail(req.owner!.email);
    audit(req, 'test_email', `to ${req.owner!.email}: ${result.ok ? 'accepted by Brevo' : result.error}`);
    if (!result.ok) return res.status(502).json({ error: `Brevo refused the email: ${result.error}` });
    res.json({ ok: true, to: req.owner!.email });
  })
);
