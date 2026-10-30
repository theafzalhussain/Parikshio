import 'dotenv/config';

const DEV_FALLBACK_SECRET = 'axiom-live-dev-secret-change-me';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const port = Number(process.env.PORT ?? 3000);

const rawSecret = (process.env.JWT_SECRET ?? '').trim();

/**
 * In production a weak or missing JWT secret means anybody can forge an admin
 * session, so we refuse to boot instead of silently running insecurely.
 * In development we fall back to a known dev secret and warn loudly.
 */
function resolveJwtSecret(): string {
  if (isProduction) {
    if (!rawSecret || rawSecret === DEV_FALLBACK_SECRET || rawSecret === 'change-me-in-production') {
      throw new Error(
        'JWT_SECRET is missing or still set to a placeholder. Generate one with:\n' +
          '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n' +
          'and set it in your environment before starting in production.'
      );
    }
    if (rawSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }
    return rawSecret;
  }
  if (!rawSecret) {
    console.warn('[config] JWT_SECRET not set — using an insecure development secret.');
    return DEV_FALLBACK_SECRET;
  }
  return rawSecret;
}

const firebaseProjectId = (
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  ''
).trim();

/**
 * Only the origin of APP_URL is ever used — password-reset links and the
 * Google Classroom OAuth callback are built from it — so a value that merely
 * carries extra path/query is normalised rather than refused. Refusing cost a
 * production boot over a cosmetic difference, and the thrown message did not
 * say what it had actually received.
 *
 * An insecure scheme in production stays fatal: reset links must not be
 * delivered over http.
 */
function resolveAppBaseUrl(): string {
  const configured = process.env.APP_URL ?? '';
  // Zero-width and bidi marks survive `trim()` and are invisible in a hosting
  // dashboard, yet they corrupt the parsed host — strip them before parsing.
  const raw = configured
    .replace(/[\u200B-\u200D\u2060\uFEFF\u202A-\u202E]/g, '')
    .trim()
    .replace(/\/+$/, '');
  const shown = JSON.stringify(configured.length > 120 ? `${configured.slice(0, 120)}…` : configured);

  if (!raw) {
    if (isProduction) throw new Error('APP_URL must be set to the public HTTPS origin in production.');
    return '';
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `APP_URL must be an absolute URL, such as https://parikshio.tech. Received: ${shown}`
    );
  }
  if (!url.hostname || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error(`APP_URL must be an http(s) URL with a hostname. Received: ${shown}`);
  }
  if (isProduction && url.protocol !== 'https:') {
    throw new Error(`APP_URL must use HTTPS in production. Received: ${shown}`);
  }
  if (url.origin !== raw) {
    console.warn(`[config] APP_URL normalised to its origin ${url.origin} (received: ${shown})`);
  }
  return url.origin;
}

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * An email address from the environment. Hosting dashboards make it easy to
 * save `=support@…`, `"support@…"` or `Name <support@…>`; Brevo rejects all of
 * those, and every email would then fail quietly. The address inside the value
 * is used instead, with a warning naming the variable so the typo can be fixed.
 */
function emailFromEnv(name: string, fallback = ''): string {
  const configured = process.env[name] ?? '';
  const raw = configured.replace(/[\u200B-\u200D\u2060\uFEFF\u202A-\u202E]/g, '').trim();
  if (!raw) return fallback;
  const found = EMAIL_IN_TEXT.exec(raw)?.[0] ?? '';
  if (!found) {
    console.warn(`[config] ${name} is not an email address (received: ${JSON.stringify(raw.slice(0, 80))}) — ignoring it.`);
    return fallback;
  }
  if (found !== raw) {
    console.warn(`[config] ${name} has extra characters around the address; using ${found} (received: ${JSON.stringify(raw.slice(0, 80))}).`);
  }
  return found.toLowerCase();
}

/**
 * Who may open the owner console. The owner address is fixed in code, so a
 * stray environment variable can never swap it. Signing in needs this email
 * plus the owner password (or a one-time code sent to the inbox). Only
 * `OWNER_EMAILS=off` is honoured, and it disables the console entirely.
 */
const OWNER_EMAIL = 'theafzalhussain786@gmail.com';
function ownerEmailsFromEnv(): string[] {
  const raw = (process.env.OWNER_EMAILS ?? '').replace(/[\u200B-\u200D\u2060\uFEFF\u202A-\u202E]/g, '').trim();
  if (/^(off|none|disabled|false|0)$/i.test(raw)) return [];
  return [OWNER_EMAIL];
}

function resolveOfflineSyncGraceMs(): number {
  const configured = process.env.OFFLINE_SYNC_GRACE_MS;
  // Production forces 0: client-reported submit times cannot be trusted, so a
  // replay must still arrive before its question closes. The default is 0 in
  // production so the server boots even when the var is unset; only an explicit
  // non-zero value in production is a misconfiguration worth refusing.
  const graceMs = nonNegativeInt(configured, isProduction ? 0 : 45_000);
  if (isProduction && graceMs > 0) {
    throw new Error(
      'OFFLINE_SYNC_GRACE_MS must be 0 in production because client-reported submit times cannot be trusted.'
    );
  }
  return isProduction ? 0 : graceMs;
}

export const config = {
  port,
  jwtSecret: resolveJwtSecret(),
  /** How long a login stays valid. Accepts any `jsonwebtoken` duration string. */
  sessionTtl: (process.env.SESSION_TTL ?? '12h').trim() || '12h',
  mongoUri: (process.env.MONGODB_URI ?? '').trim(),
  redisUrl: (process.env.REDIS_URL ?? '').trim(),
  /** Grace window (ms) after a question locks during which a late submit is still accepted */
  graceMs: 1500,
  /** Development-only allowance for offline answer delivery after a deadline. */
  offlineSyncGraceMs: resolveOfflineSyncGraceMs(),
  /** Explicitly trusted proxy addresses/subnets; an empty list trusts no proxy headers. */
  trustedProxies: (process.env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  nodeEnv,
  /**
   * Extra origins allowed to open a WebSocket. The UI and API share one origin,
   * so this stays empty unless you deliberately host the client elsewhere.
   */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  /** Google sign-in is enabled only when a Firebase project id is configured. */
  firebase: {
    projectId: firebaseProjectId,
    enabled: firebaseProjectId.length > 0
  },
  googleClassroom: {
    clientId: (process.env.GOOGLE_CLASSROOM_CLIENT_ID ?? '').trim(),
    clientSecret: (process.env.GOOGLE_CLASSROOM_CLIENT_SECRET ?? '').trim(),
    get enabled() {
      return this.clientId.length > 0 && this.clientSecret.length > 0;
    },
    get redirectUri() {
      const base = resolveAppBaseUrl() || `http://localhost:${port}`;
      return `${base}/api/classroom/oauth/callback`;
    }
  },
  /** Trusted public origin used to build password-reset links. */
  appBaseUrl: resolveAppBaseUrl(),
  /**
   * Brevo (transactional email): password-reset links, contact-form messages
   * to the team and the sender's confirmation copy. Sending is enabled only when
   * BREVO_API_KEY and a valid sender address are set; the sender must be a
   * verified sender (or on an authenticated domain) in the Brevo account.
   */
  brevo: {
    apiKey: (process.env.BREVO_API_KEY ?? '').trim(),
    senderEmail: emailFromEnv('BREVO_SENDER_EMAIL'),
    senderName: (process.env.BREVO_SENDER_NAME ?? 'Parikshio').trim().replace(/^["']|["']$/g, '') || 'Parikshio',
    get enabled() {
      return this.apiKey.length > 0 && this.senderEmail.length > 0;
    }
  },
  /** Password-reset link lifetime (ms). */
  passwordResetTtlMs: 30 * 60 * 1000,
  /**
   * Where contact-form messages (including faculty access requests) are
   * emailed; reply-to is the person who wrote in. Same address as the site's
   * CONTACT_EMAIL (src/lib/site.ts) unless CONTACT_INBOX_EMAIL overrides it.
   */
  contact: {
    inbox: emailFromEnv('CONTACT_INBOX_EMAIL', 'support@parikshio.tech')
  },
  /** The hidden owner console at /hq (see server/owner.ts). */
  owner: {
    emails: ownerEmailsFromEnv(),
    get enabled() {
      return this.emails.length > 0;
    },
    /** How long one owner sign-in lasts. */
    sessionTtlMs: 12 * 60 * 60 * 1000,
    /** How long an emailed sign-in code works. */
    codeTtlMs: 10 * 60 * 1000,
    /** How long a faculty invite's "set your password" link works. */
    inviteTtlMs: 7 * 24 * 60 * 60 * 1000
  },
  /**
   * Gemini — AI evaluation of short / long answers.
   * Enabled only when GEMINI_API_KEY is set; without it subjective answers fall
   * back to answer-key matching (short) or manual review (long).
   */
  gemini: {
    apiKey: (process.env.GEMINI_API_KEY ?? '').trim(),
    /**
     * Tried in order. When a model is overloaded (503/429), times out or has been
     * retired (404), the grader cools it down and moves to the next one.
     */
    models: listFromEnv(process.env.GEMINI_MODELS, [
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.1-flash-lite'
    ]),
    /** Reasoning depth. `low` keeps grading at a few seconds; blank disables the setting. */
    thinkingLevel: (process.env.GEMINI_THINKING_LEVEL ?? 'low').trim(),
    timeoutMs: positiveInt(process.env.GEMINI_TIMEOUT_MS, 30_000),
    /** Parallel AI requests (each one grades a whole batch of answers). */
    concurrency: positiveInt(process.env.AI_GRADING_CONCURRENCY, 3),
    /**
     * Answers to the same question graded together in one request. Batching is
     * what lets a class of 60 fit inside Gemini's per-minute / per-day quotas.
     */
    batchSize: Math.min(25, positiveInt(process.env.AI_GRADING_BATCH_SIZE, 10)),
    /** Set AI_AUTO_GRADE=false to only run AI when an admin asks for it. */
    autoGrade: (process.env.AI_AUTO_GRADE ?? 'true').trim().toLowerCase() !== 'false',
    /** Below this confidence an AI score is kept but flagged for human review. */
    reviewBelowConfidence: 0.6,
    /** AI_GRADING_DEBUG=true logs every Gemini call (model, status, latency) — no answer text. */
    debug: (process.env.AI_GRADING_DEBUG ?? '').trim().toLowerCase() === 'true',
    get enabled() {
      return this.apiKey.length > 0 && this.models.length > 0;
    }
  }
};

function listFromEnv(raw: string | undefined, fallback: string[]): string[] {
  const values = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Like `positiveInt`, but 0 is a meaningful value (it disables the window). */
function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export const isProd = isProduction;
