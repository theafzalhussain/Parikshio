import crypto from 'node:crypto';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';

/**
 * Brute-force protection + audit trail.
 *
 * The limiter is an in-process fixed-window counter. That is the right trade-off
 * today because the app runs as a single process (same as the live-exam store).
 * When the app is scaled horizontally this must move behind Redis — see
 * `createRateLimiter` for the single place that needs swapping.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

interface LimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per key per window. */
  max: number;
  /** Human-readable name used in audit entries. */
  name: string;
  /**
   * Builds the throttle key. Defaults to the client IP. Return `null` to skip
   * limiting for this request.
   */
  keyFor?: (req: Request) => string | null;
  message?: string;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Render puts every service behind Cloudflare and a proxy on the same machine,
 * so the connection always comes from a private address (production sign-ins
 * were all recorded as 127.0.0.1). Every visitor then shared one rate-limit
 * bucket: 40 sign-ups an hour for the whole site, and one attacker could lock
 * everyone out of logging in. Cloudflare sets CF-Connecting-IP to the real
 * visitor address and overwrites any value a client sends, so it is trusted
 * only when running on Render (or when CLIENT_IP_HEADER opts in) and only when
 * the request reached us through that local proxy.
 */
const CLOUDFLARE_IP_HEADER =
  process.env.RENDER === 'true' || (process.env.CLIENT_IP_HEADER ?? '').trim().toLowerCase() === 'cf-connecting-ip';
const PRIVATE_PEER = /^(?:::1$|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|fe80:)/i;
const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{2,39})$/i;
const EXPLICIT_PROXIES = (process.env.TRUSTED_PROXIES ?? '').trim().length > 0;

function bare(address: string | undefined): string {
  return (address ?? '').replace(/^::ffff:/i, '');
}

export function clientIp(req: Request): string {
  const peer = bare(req.socket?.remoteAddress);
  if (CLOUDFLARE_IP_HEADER && !EXPLICIT_PROXIES && PRIVATE_PEER.test(peer)) {
    const header = req.headers['cf-connecting-ip'];
    const value = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
    if (IP_LITERAL.test(value)) return value;
  }
  return bare(req.ip) || peer || 'unknown';
}

/** Counting limiter — every request through it consumes quota. */
export function createRateLimiter(options: LimiterOptions) {
  const { windowMs, max, name, keyFor, message } = options;

  return function rateLimiter(req: Request, res: ExpressResponse, next: NextFunction) {
    const scope = keyFor ? keyFor(req) : clientIp(req);
    if (!scope) return next();

    const key = `${name}:${scope}`;
    const now = Date.now();
    sweep(now);

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(max - 1));
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) return reject(req, res, name, scope, bucket, max, message);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    return next();
  };
}

function reject(
  req: Request,
  res: ExpressResponse,
  name: string,
  scope: string,
  bucket: Bucket,
  max: number,
  message?: string
) {
  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
  res.setHeader('Retry-After', String(retryAfterSec));
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', '0');
  recordAudit({
    action: 'security.rate_limited',
    actorId: null,
    actorName: scope,
    detail: `${name} throttled`,
    ip: clientIp(req)
  });
  return res.status(429).json({
    error:
      message ??
      `Too many attempts. Please wait ${
        retryAfterSec > 60 ? `${Math.ceil(retryAfterSec / 60)} minutes` : `${retryAfterSec} seconds`
      } and try again.`,
    code: 'security/rate-limited',
    retryAfterSeconds: retryAfterSec
  });
}

/**
 * Failure-only guard.
 *
 * Blocks a request when the key has *already* accumulated too many failures,
 * but a request passing through it consumes nothing. The route calls
 * `penalise()` when credentials turn out to be wrong.
 *
 * This matters for institutes: a whole school shares one public IP behind NAT,
 * so counting every successful sign-in would lock out an entire classroom.
 * Only genuine failures count, so normal usage is never throttled.
 */
export function createFailureGuard(options: LimiterOptions) {
  const { windowMs, max, name, keyFor, message } = options;

  return function failureGuard(req: Request, res: ExpressResponse, next: NextFunction) {
    const scope = keyFor ? keyFor(req) : clientIp(req);
    if (!scope) return next();

    const now = Date.now();
    sweep(now);
    const bucket = buckets.get(`${name}:${scope}`);
    if (bucket && bucket.resetAt > now && bucket.count >= max) {
      return reject(req, res, name, scope, bucket, max, message);
    }
    void windowMs; // window is applied by penalise(), kept here for symmetry
    return next();
  };
}

/** Records one failed attempt against a guard key. */
export function penalise(name: string, scope: string, windowMs: number): void {
  if (!scope) return;
  const key = `${name}:${scope}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
}

/** Clears a throttle bucket — call after a successful login so one bad streak doesn't linger. */
export function resetRateLimit(name: string, scope: string): void {
  buckets.delete(`${name}:${scope}`);
}

// ── Limiters used by the auth routes ──────────────────────────
const normaliseEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Per-account failure ceiling — this is what stops targeted password guessing. */
export const LOGIN_EMAIL_MAX = 6;
/**
 * Per-IP failure ceiling. Deliberately generous because an institute's students
 * all share one public address; it only ever counts failures.
 */
export const LOGIN_IP_MAX = 50;

export const loginIpGuard = createFailureGuard({
  name: 'login:ip',
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_IP_MAX,
  message: 'Too many failed sign-ins from this network. Please wait a few minutes and try again.'
});

export const loginEmailGuard = createFailureGuard({
  name: 'login:email',
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_EMAIL_MAX,
  keyFor: (req) => normaliseEmail((req.body as { email?: unknown } | undefined)?.email) || null,
  message:
    'Too many failed attempts for this account. Wait a few minutes or reset your password.'
});

/** Call after a wrong password so both guards advance. */
export function penaliseLogin(ip: string, email: string): void {
  penalise('login:ip', ip, LOGIN_WINDOW_MS);
  if (email) penalise('login:email', email, LOGIN_WINDOW_MS);
}

/** Call after a correct password so the account is immediately unthrottled. */
export function clearLoginPenalties(ip: string, email: string): void {
  resetRateLimit('login:ip', ip);
  if (email) resetRateLimit('login:email', email);
}

export const registerLimiter = createRateLimiter({
  name: 'register:ip',
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: 'Too many accounts created from this network. Please try again later.'
});

export const forgotPasswordLimiter = createRateLimiter({
  name: 'forgot:ip',
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many reset requests. Please wait before requesting another link.'
});

/** Per-email reset ceiling — stops mailbox flooding of one account. */
export const forgotPasswordEmailLimiter = createRateLimiter({
  name: 'forgot:email',
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyFor: (req) => normaliseEmail((req.body as { email?: unknown } | undefined)?.email) || null,
  message: 'A reset link was already sent for this email. Check your inbox before requesting another.'
});

export const resetPasswordLimiter = createRateLimiter({
  name: 'reset:ip',
  windowMs: 30 * 60 * 1000,
  max: 20,
  message: 'Too many reset attempts. Request a fresh link and try again.'
});

export const googleLimiter = createRateLimiter({
  name: 'google:ip',
  windowMs: 15 * 60 * 1000,
  max: 60
});

// ── Audit log ─────────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string;
  detail: string;
  ip: string;
  at: number;
}

const AUDIT_CAP = 2000;
const auditEntries: AuditEntry[] = [];

/** Hook used by api.ts to mirror audit entries into MongoDB without a circular import. */
let auditSink: ((entry: AuditEntry) => void) | null = null;
export function setAuditSink(sink: (entry: AuditEntry) => void): void {
  auditSink = sink;
}

export function recordAudit(input: Omit<AuditEntry, 'id' | 'at'>): AuditEntry {
  const entry: AuditEntry = {
    ...input,
    id: `aud_${crypto.randomBytes(8).toString('hex')}`,
    at: Date.now()
  };
  auditEntries.push(entry);
  if (auditEntries.length > AUDIT_CAP) auditEntries.splice(0, auditEntries.length - AUDIT_CAP);
  auditSink?.(entry);
  return entry;
}

export function listAudit(limit = 100): AuditEntry[] {
  return auditEntries.slice(-limit).reverse();
}

/** Replaces the in-memory audit buffer on boot (hydrated from MongoDB). */
export function hydrateAudit(entries: AuditEntry[]): void {
  auditEntries.length = 0;
  auditEntries.push(...entries.slice(-AUDIT_CAP));
}

// ── Password-reset tokens ─────────────────────────────────────
/**
 * Only the SHA-256 hash of a reset token is stored, so a leaked database dump
 * cannot be used to hijack accounts.
 */
export function createResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare so reset-token checks don't leak timing information. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Password strength ─────────────────────────────────────────
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters long';
  if (password.length > 128) return 'Password must be under 128 characters';
  if (!/[a-zA-Z]/.test(password)) return 'Password must contain at least one letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  const common = ['password', '12345678', 'qwerty123', 'admin123', 'student123', 'letmein1'];
  if (common.includes(password.toLowerCase())) return 'That password is too common — pick something harder to guess';
  return null;
}
