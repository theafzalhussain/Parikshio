import { Router, type NextFunction, type RequestHandler, type Response as ExpressResponse } from 'express';
import multer from 'multer';
import type { Paper, PaperKind, Question, QuestionInput, QuestionType } from '../shared/types';
import { parseQuestionPaper } from './extract';
import { MAX_UPLOAD_BYTES, extractTextFromFile, kindForFile } from './files';
import { emitAllStaff } from './realtime';
import {
  activeWindow,
  analytics,
  buildExamPublic,
  closeSet,
  deleteExam,
  deliveredCount,
  endExam,
  getLeaderboard,
  lockQuestion,
  manualGrade,
  openSetQuestion,
  pushQuestion,
  pushSet,
  refreshStudentViews,
  repushSetItem,
  sanitizeQuestion,
  setMonitor,
  skipSetQuestion,
  SET_MAX_ITEMS,
  type DeletedExamSummary
} from './engine';
import { DEFAULT_SETTINGS, examSettings, inOpenSet, resultSealed, studentsSeeLeaderboard } from './sessionRules';
import {
  aiGradingEnabled,
  gradingStatus,
  previewEvaluation,
  queueExamAiEvaluations,
  requestAiEvaluation,
  type BulkScope
} from './grading';
import { GeminiError } from './gemini';
import {
  classroomStatus,
  createClassroomAuthorizationUrl,
  discardClassroomAuthorization,
  disconnectClassroom,
  finishClassroomAuthorization,
  getClassroomCourse,
  listClassroomCourses,
  listClassroomRoster,
  publishExamResults
} from './googleClassroom';
import { isSubjective } from '../shared/grade';
import {
  authenticate,
  hashPassword,
  issueSession,
  publicUser,
  requireRole,
  userFromToken,
  verifyPassword,
  type AuthedRequest
} from './auth';
import { verifyFirebaseIdToken } from './firebase';
import { sendContactConfirmation, sendContactNotification, sendPasswordResetEmail, emailEnabled } from './email';
import { contactReference, shouldSendContactCopy } from './contactRules';
import { config, isProd } from './config';
import {
  clientIp,
  clearLoginPenalties,
  createRateLimiter,
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
import { db, examCode, store, uid, type ContactMessage, type PasswordReset, type StoredUser } from './store';
import {
  CONTACT_LIMITS,
  CONTACT_ROLES,
  contactTopicLabel,
  isContactRole,
  isContactTopic
} from '../shared/contact';
import { DEMO_ACCOUNT_EMAILS, isDemoAccountEmail } from './demoAccounts';
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
const classroomLimiter = createRateLimiter({
  name: 'google-classroom',
  windowMs: 60_000,
  max: 20,
  keyFor: (req) => (req as AuthedRequest).user?.id ?? clientIp(req),
  message: 'Too many Google Classroom requests — wait a minute and try again.'
});

api.post('/auth/login', loginIpGuard, loginEmailGuard, (req, res) => {
  const email = sanitiseEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const ip = clientIp(req);

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.userByEmail(email);
  if (isProd && isDemoAccountEmail(email)) {
    penaliseLogin(ip, email);
    recordAudit({
      action: 'auth.login_failed',
      actorId: user?.id ?? null,
      actorName: email,
      detail: 'unavailable demo account',
      ip
    });
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
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
    admin: { email: DEMO_ACCOUNT_EMAILS.admin, password: 'admin123' },
    student: { email: DEMO_ACCOUNT_EMAILS.aarav, password: 'student123' }
  });
});

/** Tells the client which optional auth providers are actually configured. */
api.get('/auth/providers', (_req, res) => {
  res.json({ google: config.firebase.enabled, password: true });
});

// ── Google Classroom ───────────────────────────────────────────
api.get('/classroom/status', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const user = db.userById(req.user!.id);
  if (!user) return res.status(401).json({ error: 'Faculty account is no longer available.' });
  res.json({ classroom: classroomStatus(user) });
});

api.post('/classroom/oauth/start', authenticate, requireRole('admin'), classroomLimiter, (req: AuthedRequest, res) => {
  const user = db.userById(req.user!.id);
  if (!user) return res.status(401).json({ error: 'Faculty account is no longer available.' });
  const examId = String(req.body?.examId ?? '');
  const exam = examId ? db.examById(examId) : undefined;
  if (examId && (!exam || exam.adminId !== user.id)) {
    return res.status(404).json({ error: 'Exam not found.' });
  }
  const returnTo = exam ? `/admin/exams/${encodeURIComponent(exam.id)}` : '/admin/exams';
  try {
    return res.json({ authorizationUrl: createClassroomAuthorizationUrl(user, returnTo) });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : 'Google Classroom is unavailable.' });
  }
});

api.get('/classroom/oauth/callback', asyncRoute(async (req: AuthedRequest, res) => {
  const state = String(req.query.state ?? '');
  const providerError = String(req.query.error ?? '');
  if (providerError) {
    const pending = discardClassroomAuthorization(state);
    const base = config.appBaseUrl || `http://localhost:${config.port}`;
    return res.redirect(`${base}${pending?.returnTo ?? '/admin/exams'}?classroom=denied`);
  }
  try {
    const pending = await finishClassroomAuthorization(state, String(req.query.code ?? ''));
    const base = config.appBaseUrl || `http://localhost:${config.port}`;
    return res.redirect(`${base}${pending.returnTo}?classroom=connected`);
  } catch (error) {
    console.warn('[classroom] OAuth callback failed:', error instanceof Error ? error.message : 'unknown error');
    const base = config.appBaseUrl || `http://localhost:${config.port}`;
    return res.redirect(`${base}/admin/exams?classroom=error`);
  }
}));

api.post('/classroom/disconnect', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const user = db.userById(req.user!.id);
  if (!user) return res.status(401).json({ error: 'Faculty account is no longer available.' });
  disconnectClassroom(user);
  res.json({ classroom: classroomStatus(user) });
});

api.get('/classroom/courses', authenticate, requireRole('admin'), classroomLimiter, asyncRoute(async (req: AuthedRequest, res) => {
  const user = db.userById(req.user!.id);
  if (!user) return res.status(401).json({ error: 'Faculty account is no longer available.' });
  res.json({ courses: await listClassroomCourses(user) });
}));

api.post('/exams/:id/classroom/course', authenticate, requireRole('admin'), classroomLimiter, asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam || exam.adminId !== req.user!.id) return res.status(404).json({ error: 'Exam not found.' });
  if (exam.classroomCourseWorkId) {
    return res.status(409).json({ error: 'This exam already has a Classroom coursework item; keep the existing course link for safe retries.' });
  }
  const courseId = String(req.body?.courseId ?? '').trim().slice(0, 256);
  if (!courseId) return res.status(400).json({ error: 'Select a Google Classroom course.' });
  const user = db.userById(req.user!.id);
  if (!user) return res.status(401).json({ error: 'Faculty account is no longer available.' });
  const course = await getClassroomCourse(user, courseId);
  if (!course) return res.status(404).json({ error: 'That active course is not available to the connected teacher.' });
  exam.classroomCourseId = course.id;
  exam.classroomCourseName = course.section ? `${course.name} · ${course.section}` : course.name;
  exam.classroomPublishStatus = undefined;
  exam.classroomPublishError = undefined;
  exam.classroomPublishedAt = undefined;
  persist('exams', asPersistable(exam));
  res.json({ exam });
}));

api.post('/exams/:id/classroom/sync-roster', authenticate, requireRole('admin'), classroomLimiter, asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam || exam.adminId !== req.user!.id) return res.status(404).json({ error: 'Exam not found.' });
  if (!exam.classroomCourseId) return res.status(409).json({ error: 'Link a Google Classroom course to this exam first.' });
  const user = db.userById(req.user!.id);
  if (!user) return res.status(401).json({ error: 'Faculty account is no longer available.' });
  const roster = await listClassroomRoster(user, exam.classroomCourseId);
  const studentsByEmail = new Map(
    store.users.filter((student) => student.role === 'student').map((student) => [student.email.toLowerCase(), student])
  );
  const syncedRoster = roster.map((student) => ({
    ...student,
    studentId: studentsByEmail.get(student.email)?.id ?? null
  }));
  res.json({
    courseId: exam.classroomCourseId,
    courseName: exam.classroomCourseName,
    roster: syncedRoster,
    matchedCount: syncedRoster.filter((student) => student.studentId).length,
    unmatchedCount: syncedRoster.filter((student) => !student.studentId).length
  });
}));

api.post('/exams/:id/classroom/publish-results', authenticate, requireRole('admin'), classroomLimiter, asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam || exam.adminId !== req.user!.id) return res.status(404).json({ error: 'Exam not found.' });
  try {
    const result = await publishExamResults(exam);
    exam.classroomPublishStatus = 'published';
    exam.classroomPublishError = undefined;
    exam.classroomPublishedAt = result.publishedAt;
    persist('exams', asPersistable(exam));
    res.json({ classroom: result, exam });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not publish Google Classroom results.';
    exam.classroomPublishStatus = 'failed';
    exam.classroomPublishError = message.slice(0, 500);
    persist('exams', asPersistable(exam));
    res.status(502).json({ error: message, classroom: { status: 'failed' } });
  }
}));

api.post('/auth/register', registerLimiter, (req, res) => {
  const name = sanitiseName(req.body?.name, '');
  const email = sanitiseEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  if (req.body?.role === 'admin') {
    return res.status(403).json({ error: 'Faculty accounts must be provisioned by an administrator.' });
  }
  const role = 'student' as const;
  // Blank stays blank: the old 'Axiom Institute' placeholder ended up shown as
  // if it were the student's real institute.
  const org = sanitiseName(req.body?.org, '');
  const ip = clientIp(req);

  if (!name) return res.status(400).json({ error: 'Full name is required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (isProd && isDemoAccountEmail(email)) {
    return res.status(409).json({ error: 'This email is not available for public registration.' });
  }
  const weak = passwordProblem(password);
  if (weak) return res.status(400).json({ error: weak });
  if (db.userByEmail(email)) {
    return res.status(409).json({ error: 'This email is already registered. Try logging in instead.' });
  }

  const user: StoredUser = {
    id: uid('stu_'),
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
  if (req.body?.role === 'admin') {
    return res.status(403).json({ error: 'Faculty accounts must be provisioned by an administrator.' });
  }
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

  if (isProd && isDemoAccountEmail(email)) {
    recordAudit({
      action: 'auth.google_failed',
      actorId: null,
      actorName: email,
      detail: 'unavailable demo account',
      ip
    });
    return res.status(403).json({ error: 'This account is not available.' });
  }

  let user = db.userByGoogleId(googleId) ?? db.userByEmail(email);
  let created = false;

  if (!user && req.body?.mode === 'signin') {
    // The faculty tab signs in only: a Google account with no Parikshio
    // account must not quietly become a new student account.
    recordAudit({ action: 'auth.google_failed', actorId: null, actorName: email, detail: 'no account (sign-in only)', ip });
    return res.status(404).json({
      error:
        'No Parikshio account uses this Google address. Faculty accounts are created on request — use “Request access” below, or log in with email.',
      code: 'auth/no-account'
    });
  }

  if (!user) {
    user = {
      id: uid('stu_'),
      name: sanitiseName(name, email.split('@')[0]),
      email,
      role: 'student',
      org: sanitiseName(req.body?.org, ''),
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

  const resetUrl = `${config.appBaseUrl || `${req.protocol}://${req.get('host') ?? `localhost:${config.port}`}`}${link}`;

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
      pushedCount: deliveredCount(exam)
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
      pendingReviews: store.responses.filter((r) => r.grade === 'pending').length,
      aiGraded: store.responses.filter((r) => r.gradedBy === 'ai').length
    },
    grading: gradingStatus(),
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
    // Fill-in-the-blank is always key-graded. Short answers can be scored by the
    // AI evaluator without a key, but need one when AI is off (or nothing would
    // ever grade them automatically).
    if (input.type === 'fill' && accepted.length === 0)
      return 'Add at least one accepted answer for auto-grading';
    if (input.type === 'short' && accepted.length === 0 && !aiGradingEnabled())
      return 'Add at least one accepted answer (or enable AI grading with GEMINI_API_KEY)';
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

const BULK_LIMIT = 500;

/** A de-duplicated, bounded list of ids from a request body, or null when it is not one. */
function idList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((id) => String(id)).filter(Boolean))].slice(0, BULK_LIMIT);
}

/**
 * Deletes many questions at once. Questions that are attached to a session are
 * left alone (deleting them would orphan its responses) and reported back, so
 * one blocked row never cancels the rest.
 */
api.post('/questions/bulk-delete', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const ids = idList(req.body?.ids);
  if (!ids || ids.length === 0) return res.status(400).json({ error: 'Select at least one question' });
  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const idx = store.questions.findIndex((q) => q.id === id);
    if (idx === -1) {
      skipped.push({ id, reason: 'not found' });
      continue;
    }
    if (store.exams.some((e) => e.questionIds.includes(id))) {
      skipped.push({ id, reason: 'attached to a session' });
      continue;
    }
    store.questions.splice(idx, 1);
    unpersist('questions', id);
    deleted.push(id);
  }
  recordAudit({
    action: 'questions.bulk_delete',
    actorId: req.user!.id,
    actorName: req.user!.name,
    detail: `${deleted.length} deleted, ${skipped.length} kept`,
    ip: clientIp(req)
  });
  res.json({ ok: true, deleted, skipped });
});

/**
 * Applies the same timer / points / difficulty / topic to many questions. Each
 * merged question goes through the normal validator, so a bulk edit can never
 * produce a question the single-question form would have refused.
 */
api.post('/questions/bulk-update', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const ids = idList(req.body?.ids);
  if (!ids || ids.length === 0) return res.status(400).json({ error: 'Select at least one question' });
  const raw = (req.body?.patch ?? {}) as Record<string, unknown>;
  const patch: Partial<QuestionInput> = {};
  if (raw.timerSeconds !== undefined && raw.timerSeconds !== '') patch.timerSeconds = Number(raw.timerSeconds);
  if (raw.points !== undefined && raw.points !== '') patch.points = Number(raw.points);
  if (raw.difficulty !== undefined && raw.difficulty !== '') {
    if (!['easy', 'medium', 'hard'].includes(String(raw.difficulty))) {
      return res.status(400).json({ error: 'Difficulty must be easy, medium or hard' });
    }
    patch.difficulty = String(raw.difficulty) as QuestionInput['difficulty'];
  }
  if (typeof raw.topic === 'string' && raw.topic.trim()) patch.topic = raw.topic.trim().slice(0, 80);
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Choose at least one field to change' });

  const updated: Question[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    const question = db.questionById(id);
    if (!question) {
      failed.push({ id, error: 'Question not found' });
      continue;
    }
    const merged = { ...question, ...patch } as QuestionInput;
    const error = validateQuestion(merged);
    if (error) {
      failed.push({ id, error });
      continue;
    }
    Object.assign(question, questionFieldsFrom(merged));
    persist('questions', asPersistable(question));
    updated.push(question);
  }
  res.json({ ok: true, updated, failed });
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
    exams: db.exams().map((exam) => {
      const rows = store.responses.filter((r) => r.examId === exam.id);
      const participation = new Set(rows.map((r) => r.studentId)).size;
      return {
        ...exam,
        participation,
        responseCount: rows.length,
        settings: examSettings(exam),
        // The list cards show this; it used to be missing, so every card read blank.
        avgScore: participation ? Number((rows.reduce((a, b) => a + b.awarded, 0) / participation).toFixed(1)) : 0,
        pushedCount: deliveredCount(exam)
      };
    })
  });
});

/**
 * Deleting a session removes its answers, set timers and analytics for good;
 * the questions stay in the bank. Students still in the room are sent back to
 * their lobby. The list and the control room both confirm first.
 */
function removeExams(ids: string[], req: AuthedRequest) {
  const deleted: DeletedExamSummary[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const exam = db.examById(id);
    if (!exam) {
      missing.push(id);
      continue;
    }
    deleted.push(deleteExam(exam));
  }
  if (deleted.length) {
    recordAudit({
      action: 'exams.delete',
      actorId: req.user!.id,
      actorName: req.user!.name,
      detail: deleted.map((d) => `${d.code} (${d.responses} answers)`).join(', ').slice(0, 480),
      ip: clientIp(req)
    });
  }
  return { deleted, missing };
}

api.post('/exams/bulk-delete', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const ids = idList(req.body?.ids);
  if (!ids || ids.length === 0) return res.status(400).json({ error: 'Select at least one session' });
  if (ids.length > 200) return res.status(400).json({ error: 'Delete at most 200 sessions at a time' });
  const result = removeExams(ids, req);
  if (!result.deleted.length) return res.status(404).json({ error: 'Those sessions no longer exist', ...result });
  res.json({ ok: true, ...result });
});

api.delete('/exams/:id', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const result = removeExams([req.params.id], req);
  if (!result.deleted.length) return res.status(404).json({ error: 'Exam not found' });
  res.json({ ok: true, deleted: result.deleted[0] });
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
    current: null,
    set: null,
    settings: {
      ...DEFAULT_SETTINGS,
      setDefaults: { ...DEFAULT_SETTINGS.setDefaults }
    }
  };
  store.exams.push(exam);
  persist('exams', asPersistable(exam));
  res.status(201).json({ exam });
});

/**
 * Session settings and naming. Every field is optional; only what is sent
 * changes, and booleans must really be booleans.
 */
api.patch('/exams/:id', authenticate, requireRole('admin'), asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (body.title !== undefined) {
    const title = String(body.title).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) return res.status(400).json({ error: 'Session title cannot be empty' });
    exam.title = title;
  }
  if (body.subject !== undefined) {
    exam.subject = String(body.subject).replace(/\s+/g, ' ').trim().slice(0, 120) || 'General';
  }

  const incoming = (body.settings ?? {}) as Record<string, unknown>;
  const settings = examSettings(exam);
  const flag = (value: unknown, current: boolean) => (typeof value === 'boolean' ? value : current);
  const defaults = (incoming.setDefaults ?? {}) as Record<string, unknown>;
  exam.settings = {
    showLeaderboard: flag(incoming.showLeaderboard, settings.showLeaderboard),
    revealAnswersAfterEnd: flag(incoming.revealAnswersAfterEnd, settings.revealAnswersAfterEnd),
    setDefaults: {
      revealPrompts: flag(defaults.revealPrompts, settings.setDefaults.revealPrompts),
      autoAdvance: flag(defaults.autoAdvance, settings.setDefaults.autoAdvance),
      allowSkip: flag(defaults.allowSkip, settings.setDefaults.allowSkip)
    }
  };

  persist('exams', asPersistable(exam));
  await cache.delPrefix(cacheKeys.examPrefix(exam.id));
  // Students in the room pick up the new title and leaderboard visibility.
  await refreshStudentViews(exam);
  res.json({ ok: true, exam, settings: exam.settings });
}));

api.get('/exams/:id', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const all = store.responses
    .filter((r) => r.examId === exam.id)
    .sort((a, b) => b.submittedAt - a.submittedAt);
  // Latest 40 for the live feed, plus anything still awaiting a grade so older
  // reviews and failed AI evaluations never fall off the control room.
  const recent = all.slice(0, 40);
  const recentIds = new Set(recent.map((r) => r.id));
  const outstanding = all.filter(
    (r) => !recentIds.has(r.id) && (r.grade === 'pending' || r.ai?.status === 'failed' || r.ai?.needsReview)
  );
  res.json({
    exam,
    counts: { responses: all.length, students: new Set(all.map((r) => r.studentId)).size },
    questions: exam.questionIds.map((id) => db.questionById(id)).filter(Boolean),
    active: activeWindow(exam),
    set: setMonitor(exam),
    settings: examSettings(exam),
    leaderboard: getLeaderboard(exam.id),
    grading: gradingStatus(),
    responses: [...recent, ...outstanding].map((r) => ({
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
  // Accepts one id (`questionId`) or many (`questionIds`) — the bank's bulk
  // "add to session" sends a list.
  const ids = idList(req.body?.questionIds) ?? [String(req.body?.questionId ?? '')];
  const missing = ids.filter((id) => !db.questionById(id));
  if (ids.length === 0 || missing.length === ids.length) return res.status(404).json({ error: 'Question not found' });
  let added = 0;
  for (const id of ids) {
    if (missing.includes(id) || exam.questionIds.includes(id)) continue;
    exam.questionIds.push(id);
    added++;
  }
  if (added) {
    persist('exams', exam as unknown as { id: string } & Record<string, unknown>);
    void cache.delPrefix(cacheKeys.examPrefix(exam.id));
  }
  res.json({ ok: true, added: ids.length === 1 ? added === 1 : added, exam });
});

/**
 * Detaches questions from a session's paper. A question that already has
 * answers in this session, is on screen right now, or is part of the open set
 * stays — removing it would orphan responses or pull it from under students.
 */
api.post('/exams/:id/questions/remove', authenticate, requireRole('admin'), asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const ids = idList(req.body?.questionIds);
  if (!ids || ids.length === 0) return res.status(400).json({ error: 'Select at least one question' });
  const removed: string[] = [];
  const kept: { id: string; reason: string }[] = [];
  for (const id of ids) {
    if (!exam.questionIds.includes(id)) continue;
    if (db.responsesByExamQuestion(exam.id, id).length) {
      kept.push({ id, reason: 'already answered in this session' });
    } else if (exam.current?.questionId === id && !exam.current.locked) {
      kept.push({ id, reason: 'live on screen right now' });
    } else if (inOpenSet(exam, id)) {
      kept.push({ id, reason: 'part of the open set' });
    } else {
      removed.push(id);
    }
  }
  if (removed.length) {
    exam.questionIds = exam.questionIds.filter((id) => !removed.includes(id));
    persist('exams', asPersistable(exam));
    await cache.delPrefix(cacheKeys.examPrefix(exam.id));
  }
  res.json({ ok: true, removed, kept, exam });
}));

/**
 * Bulk push: several questions at once as a self-paced set. Each entry carries
 * its own timer (the dialog sends the same number for all when the admin picks
 * one shared timer). Students see the list and start each timer themselves.
 */
api.post('/exams/:id/push-set', authenticate, requireRole('admin'), asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Pick at least one question to push' });
  }
  if (body.items.length > SET_MAX_ITEMS) {
    return res.status(400).json({ error: `A set can hold at most ${SET_MAX_ITEMS} questions` });
  }
  const entries: { questionId: string; timerSeconds?: number }[] = [];
  for (const raw of body.items as Record<string, unknown>[]) {
    const questionId = String(raw?.questionId ?? '');
    if (!questionId) return res.status(400).json({ error: 'Every item needs a questionId' });
    let timerSeconds: number | undefined;
    if (raw.timerSeconds !== undefined && raw.timerSeconds !== null && raw.timerSeconds !== '') {
      const seconds = intOrNull(raw.timerSeconds);
      if (seconds === null || seconds < MIN_TIMER_SECONDS || seconds > MAX_TIMER_SECONDS) {
        return res
          .status(400)
          .json({ error: `Timers must be whole numbers between ${MIN_TIMER_SECONDS} and ${MAX_TIMER_SECONDS} seconds` });
      }
      timerSeconds = seconds;
    }
    entries.push({ questionId, timerSeconds });
  }
  const defaults = examSettings(exam).setDefaults;
  const pick = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const result = await pushSet(exam, entries, {
    revealPrompts: pick(body.revealPrompts, defaults.revealPrompts),
    autoAdvance: pick(body.autoAdvance, defaults.autoAdvance),
    allowSkip: pick(body.allowSkip, defaults.allowSkip)
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  recordAudit({
    action: 'exam.push_set',
    actorId: req.user!.id,
    actorName: req.user!.name,
    detail: `${exam.code}: ${entries.length} questions`,
    ip: clientIp(req)
  });
  res.json({ ok: true, exam, set: setMonitor(exam) });
}));

api.post('/exams/:id/set/close', authenticate, requireRole('admin'), asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const result = await closeSet(exam);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json({ ok: true, set: setMonitor(exam) });
}));

api.post('/exams/:id/set/repush', authenticate, requireRole('admin'), asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const questionId = String(req.body?.questionId ?? '');
  let timerSeconds: number | undefined;
  const rawTimer = req.body?.timerSeconds;
  if (rawTimer !== undefined && rawTimer !== null && rawTimer !== '') {
    const seconds = intOrNull(rawTimer);
    if (seconds === null || seconds < MIN_TIMER_SECONDS || seconds > MAX_TIMER_SECONDS) {
      return res
        .status(400)
        .json({ error: `Timer must be a whole number between ${MIN_TIMER_SECONDS} and ${MAX_TIMER_SECONDS} seconds` });
    }
    timerSeconds = seconds;
  }
  const result = await repushSetItem(exam, questionId, timerSeconds);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json({ ok: true, reopened: result.reopened, set: setMonitor(exam) });
}));

api.post('/exams/:id/lock', authenticate, requireRole('admin'), (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  lockQuestion(exam);
  res.json({ ok: true, active: activeWindow(exam) });
});

api.post('/exams/:id/end', authenticate, requireRole('admin'), asyncRoute(async (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  endExam(exam);
  let classroom: Awaited<ReturnType<typeof publishExamResults>> | { status: 'failed'; error: string } | undefined;
  if (exam.classroomCourseId && exam.adminId === req.user!.id) {
    try {
      classroom = await publishExamResults(exam);
      exam.classroomPublishStatus = 'published';
      exam.classroomPublishError = undefined;
      exam.classroomPublishedAt = classroom.publishedAt;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not publish Google Classroom results.';
      classroom = { status: 'failed', error: message };
      exam.classroomPublishStatus = 'failed';
      exam.classroomPublishError = message.slice(0, 500);
    }
    persist('exams', asPersistable(exam));
  }
  res.json({ ok: true, exam, ...(classroom ? { classroom } : {}) });
}));

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

// ── Admin: dual-mode grading (answer key + AI evaluation) ─────
/**
 * AI calls cost money and quota, so even admins are throttled per account.
 * Keyed by user id (these routes are authenticated) rather than IP, so faculty
 * sharing an institute network do not throttle each other.
 */
const aiActionLimiter = createRateLimiter({
  name: 'ai-grading',
  windowMs: 60_000,
  max: 40,
  keyFor: (req) => (req as AuthedRequest).user?.id ?? clientIp(req),
  message: 'Too many AI grading requests — wait a minute and try again.'
});
const aiBulkLimiter = createRateLimiter({
  name: 'ai-grading-bulk',
  windowMs: 60_000,
  max: 6,
  keyFor: (req) => (req as AuthedRequest).user?.id ?? clientIp(req),
  message: 'Bulk AI grading was requested too often — wait a minute and try again.'
});

/** Which engine grades which format, and the live state of the AI queue. */
api.get('/grading/status', authenticate, requireRole('admin'), (_req: AuthedRequest, res) => {
  res.json({ grading: gradingStatus() });
});

/**
 * AI Evaluation API — dry run. Scores an answer for an existing short/long
 * question (`questionId`) or an unsaved draft (`question`) without storing
 * anything. Lets faculty test a rubric before the session goes live.
 */
api.post(
  '/grading/evaluate',
  authenticate,
  requireRole('admin'),
  aiActionLimiter,
  asyncRoute(async (req: AuthedRequest, res) => {
    if (!aiGradingEnabled()) {
      return res.status(503).json({ error: 'AI grading is not configured on this server (set GEMINI_API_KEY).' });
    }
    const answer = String(req.body?.answer ?? '');
    if (!answer.trim()) return res.status(400).json({ error: 'Provide a student answer to evaluate' });
    if (answer.length > 20_000) return res.status(400).json({ error: 'Answer must be under 20,000 characters' });

    let question: Question | undefined;
    if (req.body?.questionId) {
      question = db.questionById(String(req.body.questionId));
      if (!question) return res.status(404).json({ error: 'Question not found' });
    } else if (req.body?.question && typeof req.body.question === 'object') {
      const draft = req.body.question as Partial<QuestionInput>;
      const points = intOrNull(draft.points);
      if (!draft.prompt || !String(draft.prompt).trim()) return res.status(400).json({ error: 'Question prompt is required' });
      if (draft.type !== 'short' && draft.type !== 'long') return res.status(400).json({ error: 'Draft type must be short or long' });
      if (points === null || points <= 0 || points > MAX_POINTS) return res.status(400).json({ error: 'Points must be a positive whole number' });
      question = {
        id: 'draft',
        type: draft.type,
        prompt: String(draft.prompt).slice(0, MAX_PROMPT_CHARS),
        topic: String(draft.topic ?? 'General'),
        difficulty: 'medium',
        options: [],
        correctOptionIndex: null,
        acceptedAnswers: (Array.isArray(draft.acceptedAnswers) ? draft.acceptedAnswers : [])
          .map((a) => String(a).trim().slice(0, MAX_ANSWER_CHARS))
          .filter(Boolean)
          .slice(0, MAX_ACCEPTED),
        points,
        timerSeconds: 60,
        explanation: String(draft.explanation ?? '').slice(0, MAX_ANSWER_CHARS),
        createdBy: req.user!.id,
        createdAt: Date.now()
      };
    } else {
      return res.status(400).json({ error: 'Send either questionId or a draft question' });
    }

    if (!isSubjective(question.type)) {
      return res.status(400).json({
        error: 'AI evaluation is for short and long answers. MCQ, True/False and Fill in the blank are graded by the answer key.'
      });
    }

    try {
      const evaluation = await previewEvaluation(question, answer);
      return res.json({ evaluation });
    } catch (err) {
      const status = err instanceof GeminiError && (err.kind === 'config' || err.kind === 'quota') ? 503 : 502;
      return res.status(status).json({ error: `AI evaluation failed: ${(err as Error).message}` });
    }
  })
);

/** (Re-)run AI evaluation for one stored response. The result arrives over the socket. */
api.post('/responses/:id/ai-grade', authenticate, requireRole('admin'), aiActionLimiter, (req: AuthedRequest, res) => {
  const response = db.responseById(req.params.id);
  if (!response) return res.status(404).json({ error: 'Response not found' });
  const result = requestAiEvaluation(response);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  recordAudit({
    action: 'grading.ai_requested',
    actorId: req.user!.id,
    actorName: req.user!.name,
    detail: `response=${response.id} exam=${response.examId}`,
    ip: clientIp(req)
  });
  res.status(202).json({ response: result.response, queued: result.queued });
});

/** Queue AI evaluation for every pending (or every non-manual) subjective response in a session. */
api.post('/exams/:id/ai-grade', authenticate, requireRole('admin'), aiBulkLimiter, (req: AuthedRequest, res) => {
  const exam = db.examById(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  if (!aiGradingEnabled()) {
    return res.status(503).json({ error: 'AI grading is not configured on this server (set GEMINI_API_KEY).' });
  }
  const scope: BulkScope = req.body?.scope === 'all' ? 'all' : 'pending';
  const result = queueExamAiEvaluations(exam, scope);
  recordAudit({
    action: 'grading.ai_bulk_requested',
    actorId: req.user!.id,
    actorName: req.user!.name,
    detail: `exam=${exam.id} scope=${scope} queued=${result.queued}`,
    ip: clientIp(req)
  });
  res.status(202).json({ ...result, scope, grading: gradingStatus() });
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
      endedAt: e.endedAt,
      // Lets the lobby say "4 questions — answer in any order" before joining.
      openSet: e.set && !e.set.closed ? { size: e.set.items.length } : null
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
  res.json({
    exam: buildExamPublic(exam, req.user!.id),
    leaderboard: studentsSeeLeaderboard(exam) ? getLeaderboard(exam.id) : []
  });
});

api.get('/student/exams/by-code/:code', authenticate, requireRole('student'), (req: AuthedRequest, res) => {
  const exam = db.examByCode(req.params.code);
  if (!exam) return res.status(404).json({ error: 'No exam found with that code' });
  res.json({ exam: buildExamPublic(exam, req.user!.id) });
});

/** Starts this student's own timer on one question of the open set. */
api.post('/student/sets/open', authenticate, requireRole('student'), (req: AuthedRequest, res) => {
  const exam = db.examById(String(req.body?.examId ?? ''));
  if (!exam) return res.status(404).json({ error: 'Exam not found', code: 'exam-missing' });
  const result = openSetQuestion(exam, req.user!, String(req.body?.questionId ?? ''));
  if (!result.ok) return res.status(result.code).json({ error: result.error, code: result.reason });
  res.json({ exam: buildExamPublic(exam, req.user!.id) });
});

/** Gives up on the question that is open (only when the set allows skipping). */
api.post('/student/sets/skip', authenticate, requireRole('student'), (req: AuthedRequest, res) => {
  const exam = db.examById(String(req.body?.examId ?? ''));
  if (!exam) return res.status(404).json({ error: 'Exam not found', code: 'exam-missing' });
  const result = skipSetQuestion(exam, req.user!, String(req.body?.questionId ?? ''));
  if (!result.ok) return res.status(result.code).json({ error: result.error, code: result.reason });
  res.json({ exam: buildExamPublic(exam, req.user!.id) });
});

api.post('/student/answers', authenticate, requireRole('student'), asyncRoute(async (req: AuthedRequest, res) => {
  const { examId, questionId, answer, offline } = req.body ?? {};
  const exam = db.examById(String(examId));
  if (!exam) return res.status(404).json({ error: 'Exam not found', code: 'exam-missing' });
  const { submitAnswer } = await import('./engine');
  const result = submitAnswer(exam, req.user!, {
    questionId: String(questionId),
    answer: String(answer ?? ''),
    offline: offline === true
  });
  // The reason code lets the device decide whether to retry or drop the record,
  // instead of pattern-matching the human-readable message.
  if (!result.ok) return res.status(result.code).json({ error: result.error, code: result.reason });
  // AI evaluation internals (feedback that may paraphrase the model answer) are
  // staff-only; the student gets a receipt, not the marking.
  const { ai: _ai, gradedBy: _gradedBy, gradedAt: _gradedAt, ...receipt } = result.response;
  // Results stay sealed while classmates can still answer the same question —
  // a live push until it locks, a set until it closes. A replayed answer for a
  // question that has since closed may show its score.
  const sealed = resultSealed(exam, result.response.questionId);
  res.json({
    response: {
      ...receipt,
      grade: sealed ? 'pending' : result.response.grade,
      awarded: sealed ? 0 : result.response.awarded
    },
    leaderboard: studentsSeeLeaderboard(exam) ? getLeaderboard(exam.id) : [],
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
    // A grade that is still sealed for the class must not leak through the lobby.
    const visible = list.filter((r) => !exam || !resultSealed(exam, r.questionId));
    const points = visible.reduce((a, b) => a + b.awarded, 0);
    const maxPoints = list.reduce((a, b) => a + (db.questionById(b.questionId)?.points ?? 0), 0);
    const showRank = !exam || studentsSeeLeaderboard(exam);
    const board = showRank ? getLeaderboard(examId) : [];
    const me = board.find((b) => b.studentId === req.user!.id);
    return {
      examId,
      title: exam?.title ?? 'Exam',
      subject: exam?.subject ?? '',
      status: exam?.status ?? 'ended',
      code: exam?.code ?? '',
      answered: list.length,
      correct: visible.filter((r) => r.grade === 'correct').length,
      points,
      maxPoints,
      rank: me?.rank ?? null,
      cohort: board.length,
      avgLatencyMs: list.length ? Math.round(list.reduce((a, b) => a + b.latencyMs, 0) / list.length) : 0,
      lastAt: list.reduce((acc, r) => Math.max(acc, r.submittedAt), 0)
    };
  });
  res.json({ history: history.sort((a, b) => b.lastAt - a.lastAt) });
});

/**
 * Personal strengths: accuracy by question format and by topic, plus the
 * longest run of correct answers. Sealed grades are left out until they open.
 */
api.get('/student/insights', authenticate, requireRole('student'), (req: AuthedRequest, res) => {
  const rows = db
    .responsesByStudent(req.user!.id)
    .filter((r) => {
      const exam = db.examById(r.examId);
      return !exam || !resultSealed(exam, r.questionId);
    })
    .sort((a, b) => a.submittedAt - b.submittedAt);
  const graded = rows.filter((r) => r.grade !== 'pending');
  const summarise = (list: typeof graded) => {
    const correct = list.filter((r) => r.grade === 'correct').length;
    return { answered: list.length, correct, accuracy: list.length ? Math.round((correct / list.length) * 100) : 0 };
  };

  const byType = QUESTION_TYPES.map((type) => ({
    type,
    ...summarise(graded.filter((r) => db.questionById(r.questionId)?.type === type))
  })).filter((row) => row.answered > 0);

  const topics = new Map<string, typeof graded>();
  graded.forEach((r) => {
    const topic = db.questionById(r.questionId)?.topic || 'General';
    topics.set(topic, [...(topics.get(topic) ?? []), r]);
  });
  const byTopic = [...topics.entries()]
    .map(([topic, list]) => ({ topic, ...summarise(list) }))
    .sort((a, b) => b.answered - a.answered)
    .slice(0, 8);

  let bestStreak = 0;
  let run = 0;
  graded.forEach((r) => {
    run = r.grade === 'correct' ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
  });

  res.json({
    insights: {
      totals: {
        ...summarise(graded),
        pending: rows.length - graded.length,
        points: graded.reduce((a, b) => a + b.awarded, 0),
        avgLatencyMs: rows.length ? Math.round(rows.reduce((a, b) => a + b.latencyMs, 0) / rows.length) : 0
      },
      byType,
      byTopic,
      bestStreak
    }
  });
});

// ── Contact / feedback ────────────────────────────────────────
/**
 * Generous enough for a classroom sharing one public IP, tight enough that the
 * form cannot be used to flood the team inbox.
 */
const contactIpLimiter = createRateLimiter({
  name: 'contact:ip',
  windowMs: 15 * 60_000,
  max: 10,
  message: 'Several messages have been sent from this network just now. Please wait a few minutes and try again.'
});
const contactEmailLimiter = createRateLimiter({
  name: 'contact:email',
  windowMs: 15 * 60_000,
  max: 3,
  keyFor: (req) => sanitiseEmail((req.body as { email?: unknown } | undefined)?.email) || null,
  message: 'You have sent a few messages already. Please wait a few minutes before sending another.'
});
const CONTACT_KEEP_IN_MEMORY = 500;

api.post('/contact', contactIpLimiter, contactEmailLimiter, asyncRoute(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ip = clientIp(req);

  // Honeypot: a field people never see. Bots fill it; they get a success
  // response and nothing is stored or sent.
  if (typeof body.website === 'string' && body.website.trim()) {
    recordAudit({ action: 'contact.spam_dropped', actorId: null, actorName: 'honeypot', detail: 'hidden field filled', ip });
    return res.status(201).json({ ok: true });
  }

  const name = sanitiseName(body.name, '').slice(0, CONTACT_LIMITS.name);
  const email = sanitiseEmail(body.email);
  const org = sanitiseName(body.org, '').slice(0, CONTACT_LIMITS.org);
  const message = String(body.message ?? '')
    .replace(/\r\n?/g, '\n')
    // Strip control characters other than newlines and tabs.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();

  if (!isContactTopic(body.topic)) return res.status(400).json({ error: 'Choose what your message is about' });
  const topic = body.topic;
  const role = isContactRole(body.role) ? body.role : 'other';
  if (name.length < 2) return res.status(400).json({ error: 'Please tell us your name' });
  if (!EMAIL_RE.test(email) || email.length > CONTACT_LIMITS.email) {
    return res.status(400).json({ error: 'Enter a valid email address so we can reply' });
  }
  if (message.length < CONTACT_LIMITS.messageMin) {
    return res.status(400).json({ error: `Please write at least ${CONTACT_LIMITS.messageMin} characters` });
  }
  if (message.length > CONTACT_LIMITS.messageMax) {
    return res.status(400).json({ error: `Please keep your message under ${CONTACT_LIMITS.messageMax} characters` });
  }
  const ratingValue = intOrNull(body.rating);
  const rating = topic === 'feedback' && ratingValue !== null && ratingValue >= 1 && ratingValue <= 5 ? ratingValue : null;

  // Signing in is optional; when a valid session is present it is noted so the
  // team can tell which account wrote in.
  const header = req.headers.authorization ?? '';
  const sender = header.startsWith('Bearer ') ? userFromToken(header.slice(7)) : null;

  const entry: ContactMessage = {
    id: uid('msg_'),
    topic,
    role,
    name,
    email,
    org,
    message,
    rating,
    userId: sender?.id ?? null,
    userRole: sender?.role ?? null,
    createdAt: Date.now(),
    delivered: false,
    confirmationSent: false
  };
  const reference = contactReference(entry.id);
  const roleLabel = CONTACT_ROLES.find((r) => r.key === role)?.label ?? 'Other';
  const sendCopy = shouldSendContactCopy(store.contactMessages, email, entry.createdAt);

  const [team, copy] = await Promise.all([
    sendContactNotification({
      to: config.contact.inbox,
      reference,
      topic,
      topicLabel: contactTopicLabel(topic),
      roleLabel,
      name,
      email,
      org,
      message,
      rating,
      signedInAs: sender ? `${sender.name} (${sender.role === 'admin' ? 'faculty' : 'student'}, ${sender.email})` : null,
      receivedAt: entry.createdAt
    }),
    sendCopy
      ? sendContactConfirmation({
          to: email,
          replyTo: config.contact.inbox,
          reference,
          topic,
          topicLabel: contactTopicLabel(topic),
          roleLabel,
          name,
          org,
          message,
          rating,
          receivedAt: entry.createdAt
        })
      : Promise.resolve({ ok: false, error: 'daily confirmation limit for this address' })
  ]);
  entry.delivered = team.ok;
  entry.confirmationSent = copy.ok;
  if (emailEnabled()) {
    // Stored either way; the log lines make a broken mail setup diagnosable.
    if (!team.ok) console.warn(`[contact] team notification failed: ${team.error}`);
    if (!copy.ok && sendCopy) console.warn(`[contact] confirmation to sender failed: ${copy.error}`);
  }

  store.contactMessages.push(entry);
  if (store.contactMessages.length > CONTACT_KEEP_IN_MEMORY) {
    store.contactMessages.splice(0, store.contactMessages.length - CONTACT_KEEP_IN_MEMORY);
  }
  persist('contactMessages', asPersistable(entry));
  recordAudit({
    action: 'contact.received',
    actorId: sender?.id ?? null,
    actorName: name,
    detail: `topic=${topic} delivered=${team.ok} confirmation=${copy.ok}`,
    ip
  });

  res.status(201).json({ ok: true, id: entry.id, reference, confirmationSent: copy.ok });
}));

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
