import { Router, type NextFunction, type RequestHandler, type Response as ExpressResponse } from 'express';
import multer from 'multer';
import type { Paper, PaperKind, Question, QuestionInput, QuestionType } from '../shared/types';
import { parseQuestionPaper } from './extract';
import { MAX_UPLOAD_BYTES, extractTextFromFile, kindForFile } from './files';
import { emitAllStaff } from './realtime';
import { analytics, buildExamPublic, endExam, getLeaderboard, lockQuestion, manualGrade, pushQuestion, sanitizeQuestion, activeWindow } from './engine';
import {
  authenticate,
  hashPassword,
  issueSession,
  publicUser,
  requireRole,
  verifyPassword,
  type AuthedRequest
} from './auth';
import { verifyFirebaseIdToken } from './firebase';
import { sendPasswordResetEmail, emailEnabled } from './email';
import { config, isProd } from './config';
import {
  clientIp,
  clearLoginPenalties,
  createResetToken,
  forgotPasswordEmailLimiter,
  forgotPasswordLimiter,
  googleLimiter,
  hashToken,
  listAudit,
  loginEmailGuard,
  loginIpGuard,
  passwordProblem,
  penaliseLogin,
  recordAudit,
  registerLimiter,
  resetPasswordLimiter
} from './security';
import { db, examCode, store, uid, type PasswordReset, type StoredUser } from './store';
import { persist, unpersist, mongoReady } from './mongo';
import { cache, cacheKeys } from './cache';
import type { Exam } from '../shared/types';

/**
 * Express 4 ignores a promise rejected by a route handler: the request hangs
 * forever and the failure resurfaces as an unhandled rejection, which on
 * Node 15+ terminates the process — taking the in-memory store with it when
 * MongoDB is not configured. Wrapping an async handler forwards its failure to
 * the error middleware in `server/index.ts` instead.
 */
function asyncRoute(
  handler: (req: AuthedRequest, res: ExpressResponse, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req as AuthedRequest, res, next).catch(next);
  };
}

export const api = Router();

const QUESTION_TYPES: QuestionType[] = ['mcq', 'truefalse', 'fill', 'short', 'long'];

function asPersistable<T extends { id: string }>(doc: T) {
  return doc as unknown as { id: string } & Record<string, unknown>;
}

// ── Auth ───────────────────────────────────────────────────────
/**
 * Generic reply used for both "email not found" and "email sent" so the
 * endpoint can't be used to discover which addresses have accounts.
 */
const RESET_SENT_MESSAGE =
  'If that email has an account, a password reset link is on its way. Check your inbox and spam folder.';

function sanitiseName(value: unknown, fallback = 'User'): string {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  return name.slice(0, 80) || fallback;
}

function sanitiseEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().slice(0, 160);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

api.post('/auth/login', loginIpGuard, loginEmailGuard, (req, res) => {
  const email = sanitiseEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const ip = clientIp(req);

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.userByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    // Only wrong credentials advance the throttle — successful sign-ins are free,
    // so a classroom sharing one IP never locks itself out.
    penaliseLogin(ip, email);
    recordAudit({
      action: 'auth.login_failed',
      actorId: user?.id ?? null,
      actorName: email,
      detail: user ? 'wrong password' : 'unknown email',
      ip
    });
    // Nudge Google-only accounts towards the right button instead of a dead end.
    if (user && !user.passwordHash && user.googleId) {
      return res.status(401).json({
        error: 'This account uses Google sign-in. Use the "Continue with Google" button.',
        code: 'auth/use-google'
      });
    }
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  user.lastLoginAt = Date.now();
  persist('users', asPersistable(user));
  clearLoginPenalties(ip, email);
  recordAudit({
    action: 'auth.login',
    actorId: user.id,
    actorName: user.name,
    detail: `role=${user.role}`,
    ip
  });
  return res.json(issueSession(user));
});

api.get('/auth/me', authenticate, (req: AuthedRequest, res) => {
  return res.json({ user: req.user });
});

/**
 * Demo credentials for the seeded accounts. These are real, working logins, so
 * the route exists only outside production — otherwise it would hand an admin
 * session to anyone who knows the URL.
 */
api.get('/auth/demo', (_req, res) => {
  if (isProd) return res.status(404).json({ error: 'Not found' });
  res.json({
    admin: { email: 'admin@axiom.edu', password: 'admin123' },
    student: { email: 'aarav@axiom.edu', password: 'student123' }
  });
});

/** Tells the client which optional auth providers are actually configured. */
api.get('/auth/providers', (_req, res) => {
  res.json({ google: config.firebase.enabled, password: true });
});

api.post('/auth/register', registerLimiter, (req, res) => {
  const name = sanitiseName(req.body?.name, '');
  const email = sanitiseEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const role = req.body?.role === 'admin' ? ('admin' as const) : ('student' as const);
  const org = sanitiseName(req.body?.org, 'Axiom Institute');
  const ip = clientIp(req);

  if (!name) return res.status(400).json({ error: 'Full name is required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const weak = passwordProblem(password);
  if (weak) return res.status(400).json({ error: weak });
  if (db.userByEmail(email)) {
    return res.status(409).json({ error: 'This email is already registered. Try signing in instead.' });
  }

  const user: StoredUser = {
    id: uid(role === 'admin' ? 'usr_' : 'stu_'),
    name,
    email,
    role,
    org,
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
    emailVerified: false,
    tokenVersion: 0,
    lastLoginAt: Date.now()
  };
  store.users.push(user);
  persist('users', asPersistable(user));
  recordAudit({
    action: 'auth.register',
    actorId: user.id,
    actorName: user.name,
    detail: `role=${role} org=${org}`,
    ip
  });
  res.status(201).json(issueSession(user));
});

/**
 * Google sign-in.
 * The browser completes the Firebase popup flow and posts the resulting ID
 * token here; we verify it against Google's public certificates before trusting
 * any claim. First-time users are provisioned, returning users are linked.
 */
api.post('/auth/google', googleLimiter, asyncRoute(async (req, res) => {
  const ip = clientIp(req);
  if (!config.firebase.enabled) {
    return res.status(503).json({
      error: 'Google sign-in is not configured on this server yet.',
      code: 'auth/google-disabled'
    });
  }

  const idToken = String(req.body?.idToken ?? '');
  const verified = await verifyFirebaseIdToken(idToken);
  if (!verified.ok) {
    recordAudit({ action: 'auth.google_failed', actorId: null, actorName: 'google', detail: verified.error, ip });
    return res.status(401).json({ error: verified.error });
  }

  const { googleId, email, name, picture, emailVerified } = verified.identity;
  const requestedRole = req.body?.role === 'admin' ? ('admin' as const) : ('student' as const);

  let user = db.userByGoogleId(googleId) ?? db.userByEmail(email);
  let created = false;

  if (!user) {
    user = {
      id: uid(requestedRole === 'admin' ? 'usr_' : 'stu_'),
      name: sanitiseName(name, email.split('@')[0]),
      email,
      role: requestedRole,
      org: sanitiseName(req.body?.org, 'Axiom Institute'),
      // No password — this account signs in with Google only until it sets one.
      passwordHash: '',
      createdAt: Date.now(),
      googleId,
      avatarUrl: picture || undefined,
      emailVerified,
      tokenVersion: 0
    };
    store.users.push(user);
    created = true;
  } else {
    // Link Google to an existing email/password account on first Google login.
    user.googleId ??= googleId;
    if (picture) user.avatarUrl = picture;
    if (emailVerified) user.emailVerified = true;
  }

  user.lastLoginAt = Date.now();
  persist('users', asPersistable(user));
  recordAudit({
    action: created ? 'auth.google_register' : 'auth.google_login',
    actorId: user.id,
    actorName: user.name,
    detail: `role=${user.role}`,
    ip
  });

  res.status(created ? 201 : 200).json({ ...issueSession(user), created });
}));

/** Step 1 of password recovery — issues a single-use, 30-minute token. */
api.post('/auth/forgot-password', forgotPasswordLimiter, forgotPasswordEmailLimiter, asyncRoute(async (req, res) => {
  const email = sanitiseEmail(req.body?.email);
  const ip = clientIp(req);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });

  const user = db.userByEmail(email);
  if (!user) {
    recordAudit({ action: 'auth.forgot_unknown', actorId: null, actorName: email, detail: 'no account', ip });
    return res.json({ ok: true, message: RESET_SENT_MESSAGE });
  }

  // Invalidate any outstanding tokens so only the newest link works.
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
    expiresAt: Date.now() + config.passwordResetTtlMs,
    requestedIp: ip,
    createdAt: Date.now()
  };
  store.passwordResets.push(record);
  persist('passwordResets', asPersistable(record));
  recordAudit({
    action: 'auth.forgot_requested',
    actorId: user.id,
    actorName: user.name,
    detail: 'reset link issued',
    ip
  });

  const link = `/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;

  // Build an absolute URL for the email. Prefer the configured APP_URL; fall
  // back to the request's own origin so it works even if APP_URL is unset.
  const origin =
    config.appBaseUrl ||
    `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${req.get('host') ?? `localhost:${config.port}`}`;
  const resetUrl = `${origin}${link}`;

  // Deliver the link by email when Brevo is configured (dev or prod).
  if (emailEnabled()) {
    const result = await sendPasswordResetEmail(user.email, user.name, resetUrl);
    if (result.ok) {
      recordAudit({
        action: 'auth.forgot_email_sent',
        actorId: user.id,
        actorName: user.name,
        detail: 'reset link emailed via brevo',
        ip
      });
    } else {
      // Never fail the request (that would reveal account existence / block the
      // user); log the reason so a misconfigured key is diagnosable.
      console.warn(`[email] password-reset send failed for ${user.email}: ${result.error}`);
      recordAudit({
        action: 'auth.forgot_email_failed',
        actorId: user.id,
        actorName: user.name,
        detail: `brevo send failed: ${result.error ?? 'unknown'}`,
        ip
      });
    }
  }

  // Without an email transport configured, surface the link in dev so the flow
  // stays usable end-to-end; in production it is never returned.
  if (!isProd && !emailEnabled()) {
    console.log(`\n  🔑 Password reset link for ${user.email}:\n     ${resetUrl}\n`);
    return res.json({ ok: true, message: RESET_SENT_MESSAGE, devLink: link });
  }
  return res.json({ ok: true, message: RESET_SENT_MESSAGE });
}));

/** Step 2 — consumes the token and sets the new password. */
api.post('/auth/reset-password', resetPasswordLimiter, (req, res) => {
  const token = String(req.body?.token ?? '');
  const password = String(req.body?.password ?? '');
  const ip = clientIp(req);

  if (!token) return res.status(400).json({ error: 'Reset token is missing' });
  const weak = passwordProblem(password);
  if (weak) return res.status(400).json({ error: weak });

  const record = db.resetByTokenHash(hashToken(token));
  if (!record || record.usedAt || record.expiresAt < Date.now()) {
    recordAudit({
      action: 'auth.reset_failed',
      actorId: record?.userId ?? null,
      actorName: 'reset',
      detail: !record ? 'unknown token' : record.usedAt ? 'token already used' : 'token expired',
      ip
    });
    return res.status(400).json({
      error: 'This reset link is invalid or has expired. Request a new one.',
      code: 'auth/reset-invalid'
    });
  }

  const user = db.userById(record.userId);
  if (!user) return res.status(400).json({ error: 'That account no longer exists' });

  user.passwordHash = hashPassword(password);
  // Bump the session generation so every existing JWT for this user dies.
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  record.usedAt = Date.now();
  persist('users', asPersistable(user));
  persist('passwordResets', asPersistable(record));
  recordAudit({
    action: 'auth.reset_completed',
    actorId: user.id,
    actorName: user.name,
    detail: 'password changed via reset link; all sessions revoked',
    ip
  });

  res.json({ ok: true, ...issueSession(user) });
});

/** Signed-in password change. Requires the current password unless none is set. */
api.post('/auth/change-password', authenticate, (req: AuthedRequest, res) => {
  const user = db.userById(req.user!.id);
  if (!user) return res.status(404).json({ error: 'Account not found' });

  const currentPassword = String(req.body?.currentPassword ?? '');
  const nextPassword = String(req.body?.password ?? '');
  const ip = clientIp(req);

  // Google-only accounts have no password yet, so they can set one directly.
  if (user.passwordHash && !verifyPassword(currentPassword, user.passwordHash)) {
    recordAudit({
      action: 'auth.change_password_failed',
      actorId: user.id,
      actorName: user.name,
      detail: 'current password incorrect',
      ip
    });
    return res.status(401).json({ error: 'Your current password is incorrect' });
  }
  const weak = passwordProblem(nextPassword);
  if (weak) return res.status(400).json({ error: weak });

  user.passwordHash = hashPassword(nextPassword);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  persist('users', asPersistable(user));
  recordAudit({
    action: 'auth.change_password',
    actorId: user.id,
    actorName: user.name,
    detail: 'password changed; other sessions revoked',
    ip
  });
  res.json({ ok: true, ...issueSession(user) });
});

/** Admin-visible security trail. */
api.get('/admin/audit', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  // `Number('abc')` is NaN, and `slice(-NaN)` returns the whole buffer — so the
  // 500-entry cap has to be applied to a known-finite number.
  const requested = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(requested) ? Math.min(500, Math.max(1, Math.trunc(requested))) : 100;
  res.json({ entries: listAudit(limit) });
});

// ── Admin: overview ────────────────────────────────────────────
api.get('/admin/overview', authenticate, requireRole('admin'), asyncRoute(async (_req: AuthedRequest, res) => {
  const questions = store.questions;
  const exams = db.exams();
  const students = store.users.filter((u) => u.role === 'student');
  const byType = QUESTION_TYPES.map((type) => ({
    type,
    count: questions.filter((q) => q.type === type).length
  }));
  const graded = store.responses.filter((r) => r.grade !== 'pending');
  const accuracy = graded.length
    ? Math.round((store.responses.filter((r) => r.grade === 'correct').length / graded.length) * 100)
    : 0;

  const rows = exams.map((exam) => {
    const rowsForExam = store.responses.filter((r) => r.examId === exam.id);
    const participants = new Set(rowsForExam.map((r) => r.studentId)).size;
    const avgScore = participants
      ? Number((rowsForExam.reduce((a, b) => a + b.awarded, 0) / participants).toFixed(1))
      : 0;
    return {
      ...exam,
      participation: participants,
      avgScore,
      pushedCount: exam.current ? exam.questionIds.indexOf(exam.current.questionId) + 1 : 0
    };
  });

  const recentActivity = [...store.responses]
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .slice(0, 8)
    .map((r) => {
      const exam = db.examById(r.examId);
      return {
        id: r.id,
        studentName: r.studentName,
        grade: r.grade,
        awarded: r.awarded,
        latencyMs: r.latencyMs,
        examTitle: exam?.title ?? 'Exam',
        submittedAt: r.submittedAt
      };
    });

  const fastest = [...store.responses]
    .filter((r) => r.grade === 'correct')
    .sort((a, b) => a.latencyMs - b.latencyMs)
    .slice(0, 5)
    .map((r) => ({ studentName: r.studentName, latencyMs: r.latencyMs, examId: r.examId }));

  res.json({
    stats: {
      questions: questions.length,
      exams: exams.length,
      liveExams: exams.filter((e) => e.status === 'live').length,
      students: students.length,
      responses: store.responses.length,
      accuracy,
      pendingReviews: store.responses.filter((r) => r.grade === 'pending').length
    },
    byType,
    exams: rows,
    recentActivity,
    fastest,
    infra: {
      mongo: mongoReady() ? 'connected' : 'ephemeral (set MONGODB_URI)',
      redis: cache.stats()
    }
  });
}));

// ── Admin: question bank ──────────────────────────────────────
api.get('/questions', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const rows = db.questions({
    type: req.query.type as string | undefined,
    search: req.query.q as string | undefined,
    topic: req.query.topic as string | undefined,
    paper: req.query.paper as string | undefined
  });
  res.json({ questions: rows });
});

/** Integer coercion that refuses NaN/Infinity instead of silently propagating it. */
function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

const MAX_PROMPT_CHARS = 10_000;
const MAX_OPTIONS = 26;
const MAX_ACCEPTED = 50;
const MAX_ANSWER_CHARS = 1_000;
const MAX_POINTS = 1_000;
const MIN_TIMER_SECONDS = 5;
const MAX_TIMER_SECONDS = 3_600;

function validateQuestion(input: Partial<QuestionInput>): string | null {
  if (!input.prompt || !String(input.prompt).trim()) return 'Question prompt is required';
  if (String(input.prompt).length > MAX_PROMPT_CHARS)
    return `Question prompt must be under ${MAX_PROMPT_CHARS} characters`;
  if (!input.type || !QUESTION_TYPES.includes(input.type)) return 'Invalid question type';

  if (input.type === 'mcq') {
    const options = (input.options ?? []).filter((o) => String(o).trim());
    if (options.length < 2) return 'Multiple choice needs at least 2 options';
    if (options.length > MAX_OPTIONS) return `Multiple choice allows at most ${MAX_OPTIONS} options`;
    if (options.some((o) => String(o).length > MAX_ANSWER_CHARS))
      return `Each option must be under ${MAX_ANSWER_CHARS} characters`;
    if (input.correctOptionIndex === null || input.correctOptionIndex === undefined)
      return 'Select the correct option';
    // A non-integer or out-of-range index leaves the question with no reachable
    // correct answer, so every student would silently score zero.
    const idx = intOrNull(input.correctOptionIndex);
    if (idx === null || idx < 0 || idx >= options.length) return 'Correct option is out of range';
  }

  if (input.type === 'truefalse') {
    const idx = intOrNull(input.correctOptionIndex ?? 0);
    if (idx === null || (idx !== 0 && idx !== 1)) return 'Pick either True or False as the answer';
  }

  if (['fill', 'short', 'long'].includes(input.type)) {
    const accepted = (input.acceptedAnswers ?? []).filter((a) => String(a).trim());
    if (input.type !== 'long' && accepted.length === 0)
      return 'Add at least one accepted answer for auto-grading';
    if (accepted.length > MAX_ACCEPTED) return `At most ${MAX_ACCEPTED} accepted answers`;
    if (accepted.some((a) => String(a).length > MAX_ANSWER_CHARS))
      return `Each accepted answer must be under ${MAX_ANSWER_CHARS} characters`;
  }

  const points = intOrNull(input.points);
  if (points === null || points <= 0) return 'Points must be a whole number greater than zero';
  if (points > MAX_POINTS) return `Points must be ${MAX_POINTS} or fewer`;

  const timer = intOrNull(input.timerSeconds);
  if (timer === null || timer < MIN_TIMER_SECONDS)
    return `Timer must be a whole number of at least ${MIN_TIMER_SECONDS} seconds`;
  if (timer > MAX_TIMER_SECONDS) return `Timer must be ${MAX_TIMER_SECONDS} seconds or fewer`;

  return null;
}

/**
 * Builds the stored shape from already-validated input. Both create and update
 * go through this, so a `PATCH` can never write a field the validator did not see.
 */
function questionFieldsFrom(input: QuestionInput) {
  return {
    type: input.type,
    prompt: String(input.prompt).trim(),
    topic: String(input.topic ?? 'General').trim() || 'General',
    difficulty: input.difficulty ?? 'medium',
    options:
      input.type === 'truefalse'
        ? ['True', 'False']
        : input.type === 'mcq'
          ? (input.options ?? []).map((o) => String(o).trim()).filter(Boolean)
          : [],
    correctOptionIndex:
      input.type === 'mcq' || input.type === 'truefalse' ? Number(input.correctOptionIndex ?? 0) : null,
    acceptedAnswers:
      input.type === 'mcq' || input.type === 'truefalse'
        ? []
        : (input.acceptedAnswers ?? []).map((a) => String(a).trim()).filter(Boolean),
    points: Number(input.points),
    timerSeconds: Number(input.timerSeconds),
    explanation: String(input.explanation ?? '')
  };
}

api.post('/questions', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const input = req.body as QuestionInput;
  const error = validateQuestion(input);
  if (error) return res.status(400).json({ error });

  const question: Question = {
    id: uid('q_'),
    ...questionFieldsFrom(input),
    createdBy: req.user!.id,
    createdAt: Date.now()
  };
  store.questions.push(question);
  persist('questions', asPersistable(question));
  res.status(201).json({ question });
});

api.patch('/questions/:id', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const question = db.questionById(req.params.id);
  if (!question) return res.status(404).json({ error: 'Question not found' });
  // Merge first, then validate *and write* the same object — otherwise a partial
  // body such as `{points: 5}` validates against the merged question but writes
  // `undefined` over the prompt, options and answer key.
  const merged = { ...question, ...(req.body as QuestionInput) } as QuestionInput;
  const error = validateQuestion(merged);
  if (error) return res.status(400).json({ error });
  Object.assign(question, questionFieldsFrom(merged));
  persist('questions', asPersistable(question));
  res.json({ question });
});

api.delete('/questions/:id', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const idx = store.questions.findIndex((q) => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Question not found' });
  const inUse = store.exams.some((e) => e.questionIds.includes(req.params.id));
  if (inUse) return res.status(409).json({ error: 'Question is attached to an exam — detach it first' });
  store.questions.splice(idx, 1);
  unpersist('questions', req.params.id);
  res.json({ ok: true });
});


// ── Admin: question papers (upload → extract → import) ───────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }
});

interface ImportArgs {
  fileName: string;
  kind: PaperKind;
  text: string;
  sizeBytes: number;
  name?: string;
  subject?: string;
  user: { id: string; name: string };
  ocrUsed: boolean;
  extractionWarnings: string[];
  durationMs: number;
}

const MAX_TEXT_CHARS = 400_000;

function importPaper(args: ImportArgs):
  | { ok: true; paper: Paper; questions: Question[] }
  | { ok: false; status: number; error: string; warnings: string[]; previewText: string } {
  const text = args.text.slice(0, MAX_TEXT_CHARS);
  // The parser runs a pile of regexes over arbitrary uploaded text. A throw here
  // used to escape as an unhandled rejection; a malformed paper deserves a 422,
  // not a dead request.
  let parsed: ReturnType<typeof parseQuestionPaper>;
  try {
    parsed = parseQuestionPaper(text);
  } catch (err) {
    return {
      ok: false,
      status: 422,
      error: `Could not parse this paper: ${(err as Error).message.slice(0, 160)}`,
      warnings: args.extractionWarnings,
      previewText: text.slice(0, 1500)
    };
  }
  const warnings = [...args.extractionWarnings, ...parsed.warnings];

  if (parsed.questions.length === 0) {
    return {
      ok: false,
      status: 422,
      error:
        'No questions could be detected in this file. Check that questions start with a number (1., 2) or Q1) — you can also paste the text and fix it first.',
      warnings,
      previewText: text.slice(0, 1500)
    };
  }

  const paperId = uid('pap_');
  const paperName =
    (args.name && args.name.trim()) ||
    parsed.meta.title ||
    args.fileName.replace(/\.[a-z0-9]+$/i, '') ||
    'Untitled paper';

  const questions: Question[] = parsed.questions.map((q, index) => ({
    id: uid('q_'),
    type: q.type,
    prompt: q.prompt,
    topic: args.subject?.trim() || parsed.meta.title || 'Imported paper',
    difficulty: q.points >= 8 ? 'hard' : q.points >= 4 ? 'medium' : 'easy',
    options: q.options,
    correctOptionIndex: q.correctOptionIndex,
    acceptedAnswers: q.acceptedAnswers,
    points: q.points,
    timerSeconds: q.timerSeconds,
    explanation: q.notes.filter((n) => n.startsWith('Expected answer')).join(' ').replace('Expected answer: ', '') || '',
    createdBy: args.user.id,
    createdAt: Date.now(),
    sourcePaperId: paperId,
    sourcePaperName: paperName,
    sourceIndex: q.number || index + 1
  }));

  store.questions.push(...questions);
  questions.forEach((question) => persist('questions', asPersistable(question)));

  const paper: Paper = {
    id: paperId,
    name: paperName,
    fileName: args.fileName,
    kind: args.kind,
    sizeBytes: args.sizeBytes,
    uploadedBy: args.user.id,
    uploadedByName: args.user.name,
    uploadedAt: Date.now(),
    meta: parsed.meta,
    stats: parsed.stats,
    warnings,
    previewText: text.slice(0, 4000),
    textLength: text.length,
    ocrUsed: args.ocrUsed,
    questionIds: questions.map((q) => q.id)
  };
  store.papers.push(paper);
  persist('papers', asPersistable(paper));
  emitAllStaff('paper:imported', {
    paperId: paper.id,
    name: paper.name,
    questions: questions.length
  });

  return { ok: true, paper, questions };
}

api.post(
  '/papers/upload',
  authenticate,
  requireRole('admin'),
  (req: AuthedRequest, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const message =
          (err as { code?: string }).code === 'LIMIT_FILE_SIZE'
            ? 'File is larger than 20 MB. Split the paper into smaller files.'
            : 'Upload failed. Try again with a PDF, DOCX, image or text file.';
        return res.status(413).json({ error: message });
      }
      next();
    });
  },
  asyncRoute(async (req: AuthedRequest, res) => {
    const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ error: 'No file received' });
    const kind = kindForFile(file.originalname, file.mimetype);
    if (!kind) {
      return res.status(415).json({
        error: 'Unsupported file. Upload a PDF, DOCX, image (PNG/JPG) or plain text file.'
      });
    }

    let extraction;
    try {
      extraction = await extractTextFromFile(file.buffer, file.originalname, file.mimetype);
    } catch (err) {
      return res.status(422).json({
        error: `Could not read this file: ${(err as Error).message.slice(0, 160)}`
      });
    }

    const result = importPaper({
      fileName: file.originalname,
      kind,
      text: extraction.text,
      sizeBytes: file.size,
      name: typeof req.body?.name === 'string' ? req.body.name : undefined,
      subject: typeof req.body?.subject === 'string' ? req.body.subject : undefined,
      user: { id: req.user!.id, name: req.user!.name },
      ocrUsed: extraction.ocrUsed,
      extractionWarnings: extraction.warnings,
      durationMs: extraction.durationMs
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, warnings: result.warnings, previewText: result.previewText });
    }
    return res.status(201).json({
      paper: result.paper,
      questions: result.questions,
      extraction: { pages: extraction.pages ?? null, ocrUsed: extraction.ocrUsed, durationMs: extraction.durationMs }
    });
  })
);

api.post('/papers/text', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const { name, text, subject } = req.body ?? {};
  if (!text || String(text).trim().length < 20) {
    return res.status(400).json({ error: 'Paste at least a few questions to import.' });
  }
  const result = importPaper({
    fileName: `${(name || 'Pasted paper').toString().slice(0, 60)}.txt`,
    kind: 'text',
    text: String(text),
    sizeBytes: Buffer.byteLength(String(text), 'utf8'),
    name: name ? String(name) : undefined,
    subject: subject ? String(subject) : undefined,
    user: { id: req.user!.id, name: req.user!.name },
    ocrUsed: false,
    extractionWarnings: [],
    durationMs: 0
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error, warnings: result.warnings });
  return res.status(201).json({ paper: result.paper, questions: result.questions });
});

api.get('/papers', authenticate, requireRole('admin'), (_req: AuthedRequest, res) => {
  res.json({
    papers: db.papers().map((paper) => ({
      ...paper,
      questionCount: paper.questionIds.length,
      examTitle: paper.examId ? db.examById(paper.examId)?.title ?? null : null
    }))
  });
});

api.get('/papers/:id', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const paper = db.paperById(req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found' });
  const questions = db.questionsByPaper(paper.id);
  res.json({
    paper: { ...paper, questionCount: questions.length },
    questions,
    exam: paper.examId ? db.examById(paper.examId) ?? null : null
  });
});

api.delete('/papers/:id', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const idx = store.papers.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Paper not found' });
  const paper = store.papers[idx];
  const inUse = store.exams.some((exam) => exam.questionIds.some((id) => paper.questionIds.includes(id)));
  if (inUse) {
    return res
      .status(409)
      .json({ error: 'A session already uses questions from this paper. End or detach that session first.' });
  }
  store.questions = store.questions.filter((q) => q.sourcePaperId !== paper.id);
  paper.questionIds.forEach((id) => unpersist('questions', id));
  store.papers.splice(idx, 1);
  unpersist('papers', paper.id);
  res.json({ ok: true });
});

api.post('/papers/:id/exam', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const paper = db.paperById(req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found' });
  const questions = db.questionsByPaper(paper.id);
  if (!questions.length) return res.status(400).json({ error: 'This paper has no questions to publish' });

  const existing = paper.examId ? db.examById(paper.examId) : null;
  if (existing) return res.json({ exam: existing, created: false });

  const exam: Exam = {
    id: uid('exm_'),
    code: examCode(),
    title: String(req.body?.title ?? paper.name).trim() || paper.name,
    subject: String(req.body?.subject ?? paper.meta.title ?? 'Imported paper').trim(),
    adminId: req.user!.id,
    adminName: req.user!.name,
    status: 'draft',
    questionIds: questions.map((q) => q.id),
    createdAt: Date.now(),
    current: null
  };
  store.exams.push(exam);
  persist('exams', asPersistable(exam));
  paper.examId = exam.id;
  persist('papers', asPersistable(paper));
  res.status(201).json({ exam, created: true });
});

// ── Admin: exams ──────────────────────────────────────────────
api.get('/exams', authenticate, requireRole('admin'), (_req: AuthedRequest, res) => {
  res.json({
    exams: db.exams().map((exam) => ({
      ...exam,
      participation: new Set(store.responses.filter((r) => r.examId === exam.id).map((r) => r.studentId)).size,
      pushedCount: exam.current ? exam.questionIds.indexOf(exam.current.questionId) + 1 : 0
    }))
  });
});

api.post('/exams', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const { title, subject, questionIds } = req.body ?? {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Exam title is required' });
  const ids: string[] = Array.isArray(questionIds) ? questionIds.filter((id: string) => !!db.questionById(id)) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'Select at least one question' });

  const exam: Exam = {
    id: uid('exm_'),
    code: examCode(),
    title: String(title).trim(),
    subject: String(subject ?? 'General').trim() || 'General',
    adminId: req.user!.id,
    adminName: req.user!.name,
    status: 'draft',
    questionIds: ids,
    createdAt: Date.now(),
    current: null
  };
  store.exams.push(exam);
  persist('exams', asPersistable(exam));
  res.status(201).json({ exam });
});

api.get('/exams/:id', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  res.json({
    exam,
    questions: exam.questionIds.map((id) => db.questionById(id)).filter(Boolean),
    active: activeWindow(exam),
    leaderboard: getLeaderboard(exam.id),
    responses: store.responses
      .filter((r) => r.examId === exam.id)
      .sort((a, b) => b.submittedAt - a.submittedAt)
      .slice(0, 40)
      .map((r) => ({
        ...r,
        questionPrompt: db.questionById(r.questionId)?.prompt ?? '',
        questionType: db.questionById(r.questionId)?.type ?? 'mcq',
        maxPoints: db.questionById(r.questionId)?.points ?? 0
      }))
  });
});

api.post('/exams/:id/push', authenticate, requireRole('admin'), asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const { questionId, timerSeconds } = req.body ?? {};
  // A non-numeric override would reach the engine as NaN, which makes `endsAt`
  // NaN and the question never times out.
  let override: number | undefined;
  if (timerSeconds !== undefined && timerSeconds !== null && timerSeconds !== '') {
    const seconds = intOrNull(timerSeconds);
    if (seconds === null || seconds < MIN_TIMER_SECONDS || seconds > MAX_TIMER_SECONDS) {
      return res
        .status(400)
        .json({ error: `Timer must be a whole number between ${MIN_TIMER_SECONDS} and ${MAX_TIMER_SECONDS} seconds` });
    }
    override = seconds;
  }
  const result = await pushQuestion(exam, String(questionId), override);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, exam, active: activeWindow(exam) });
}));

api.post('/exams/:id/questions', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (exam.status === 'ended') return res.status(409).json({ error: 'This session has ended' });
  const questionId = String(req.body?.questionId ?? '');
  const question = db.questionById(questionId);
  if (!question) return res.status(404).json({ error: 'Question not found' });
  const already = exam.questionIds.includes(questionId);
  if (!already) {
    exam.questionIds.push(questionId);
    persist('exams', exam as unknown as { id: string } & Record<string, unknown>);
    void cache.delPrefix(cacheKeys.examPrefix(exam.id));
  }
  res.json({ ok: true, added: !already, exam });
});

api.post('/exams/:id/lock', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  lockQuestion(exam);
  res.json({ ok: true, active: activeWindow(exam) });
});

api.post('/exams/:id/end', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  endExam(exam);
  res.json({ ok: true, exam });
});

api.get('/exams/:id/analytics', authenticate, requireRole('admin'), asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const key = cacheKeys.analytics(exam.id);
  const cached = await cache.get(key);
  const data = cached ?? analytics(exam.id);
  if (!cached && data) await cache.set(key, data, 6);
  res.json({ analytics: data, cached: !!cached });
}));

api.get('/exams/:id/leaderboard', authenticate, requireRole('admin'), asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  res.json({ leaderboard: getLeaderboard(exam.id) });
}));

api.post('/responses/:id/grade', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const response = db.responseById(req.params.id);
  if (!response) return res.status(404).json({ error: 'Response not found' });
  // Garbage here used to become NaN and poison every leaderboard total; the
  // upper bound is the question's own worth, not an arbitrary 999.
  const awarded = Number(req.body?.awarded ?? 0);
  if (!Number.isFinite(awarded) || awarded < 0) {
    return res.status(400).json({ error: 'Awarded points must be zero or more' });
  }
  const maxPoints = db.questionById(response.questionId)?.points ?? 0;
  if (maxPoints > 0 && awarded > maxPoints) {
    return res.status(400).json({ error: `This question is worth at most ${maxPoints} points` });
  }
  const updated = manualGrade(response, awarded);
  res.json({ response: updated });
});

// ── Student ───────────────────────────────────────────────────
api.get('/student/exams', authenticate, requireRole('student'), (_req: AuthedRequest, res) => {
  const exams = db
    .exams()
    .filter((e) => e.status !== 'draft')
    .map((e) => ({
      id: e.id,
      code: e.code,
      title: e.title,
      subject: e.subject,
      status: e.status,
      totalQuestions: e.questionIds.length,
      adminName: e.adminName,
      endedAt: e.endedAt
    }));
  res.json({ exams });
});

api.post('/student/join', authenticate, requireRole('student'), (req: AuthedRequest, res) => {
  const code = String(req.body?.code ?? '').trim();
  const exam = db.examByCode(code);
  if (!exam) return res.status(404).json({ error: 'No exam found with that code' });
  if (exam.status === 'draft') return res.status(409).json({ error: 'This exam has not started yet' });
  res.json({ exam: buildExamPublic(exam, req.user!.id) });
});

api.get('/student/exams/:id', authenticate, requireRole('student'), (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  res.json({ exam: buildExamPublic(exam, req.user!.id), leaderboard: getLeaderboard(exam.id) });
});

api.get('/student/exams/by-code/:code', authenticate, requireRole('student'), (req: AuthedRequest, res) => {
  const exam = db.examByCode(req.params.code);
  if (!exam) return res.status(404).json({ error: 'No exam found with that code' });
  res.json({ exam: buildExamPublic(exam, req.user!.id) });
});

api.post('/student/answers', authenticate, requireRole('student'), asyncRoute(async (req: AuthedRequest, res) => {
  const { examId, questionId, answer } = req.body ?? {};
  const exam = db.examById(String(examId));
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const { submitAnswer } = await import('./engine');
  const result = submitAnswer(exam, req.user!, { questionId: String(questionId), answer: String(answer ?? '') });
  if (!result.ok) return res.status(result.code).json({ error: result.error });
  res.json({
    response: {
      ...result.response,
      grade: exam.current?.locked ? result.response.grade : 'pending'
    },
    leaderboard: getLeaderboard(exam.id),
    exam: buildExamPublic(exam, req.user!.id)
  });
}));

api.get('/student/history', authenticate, requireRole('student'), (req: AuthedRequest, res) => {
  const rows = db.responsesByStudent(req.user!.id);
  const grouped = new Map<string, typeof rows>();
  rows.forEach((r) => {
    const list = grouped.get(r.examId) ?? [];
    list.push(r);
    grouped.set(r.examId, list);
  });
  const history = [...grouped.entries()].map(([examId, list]) => {
    const exam = db.examById(examId);
    const points = list.reduce((a, b) => a + b.awarded, 0);
    const maxPoints = list.reduce((a, b) => a + (db.questionById(b.questionId)?.points ?? 0), 0);
    const board = getLeaderboard(examId);
    const me = board.find((b) => b.studentId === req.user!.id);
    return {
      examId,
      title: exam?.title ?? 'Exam',
      subject: exam?.subject ?? '',
      status: exam?.status ?? 'ended',
      answered: list.length,
      correct: list.filter((r) => r.grade === 'correct').length,
      points,
      maxPoints,
      rank: me?.rank ?? null,
      cohort: board.length,
      avgLatencyMs: list.length ? Math.round(list.reduce((a, b) => a + b.latencyMs, 0) / list.length) : 0,
      lastAt: Math.max(...list.map((r) => r.submittedAt))
    };
  });
  res.json({ history: history.sort((a, b) => b.lastAt - a.lastAt) });
});

// ── Infra / health ────────────────────────────────────────────
api.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    questions: store.questions.length,
    exams: store.exams.length,
    responses: store.responses.length,
    mongo: mongoReady() ? 'connected' : 'ephemeral',
    redis: cache.stats()
  });
});

export { sanitizeQuestion };
