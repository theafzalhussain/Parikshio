import 'dotenv/config';

const DEV_FALLBACK_SECRET = 'axiom-live-dev-secret-change-me';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

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

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: resolveJwtSecret(),
  /** How long a login stays valid. Accepts any `jsonwebtoken` duration string. */
  sessionTtl: (process.env.SESSION_TTL ?? '12h').trim() || '12h',
  mongoUri: (process.env.MONGODB_URI ?? '').trim(),
  redisUrl: (process.env.REDIS_URL ?? '').trim(),
  /** Grace window (ms) after a question locks during which a late submit is still accepted */
  graceMs: 1500,
  /**
   * Extra window (ms) granted only to answers replayed from a student device's
   * offline outbox. A phone that drops its connection at the buzzer reconnects
   * seconds later, and without this allowance the answer it saved locally would
   * be thrown away. The replay still has to claim a submit time that falls
   * inside the question's own window, so this buys delivery time, not thinking
   * time. Set OFFLINE_SYNC_GRACE_MS=0 to refuse late replays entirely.
   */
  offlineSyncGraceMs: nonNegativeInt(process.env.OFFLINE_SYNC_GRACE_MS, 45_000),
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
  /**
   * Absolute base URL used to build links inside emails (password reset, etc).
   * In production set APP_URL to the deployed origin, e.g.
   * https://parikshio.onrender.com — otherwise reset links point at localhost.
   */
  appBaseUrl: (process.env.APP_URL ?? '').trim().replace(/\/+$/, ''),
  /**
   * Brevo (transactional email). Only used to deliver the password-reset link.
   * Email sending is enabled only when BREVO_API_KEY and a sender address are set.
   */
  brevo: {
    apiKey: (process.env.BREVO_API_KEY ?? '').trim(),
    senderEmail: (process.env.BREVO_SENDER_EMAIL ?? '').trim(),
    senderName: (process.env.BREVO_SENDER_NAME ?? 'Parikshio').trim(),
    get enabled() {
      return this.apiKey.length > 0 && this.senderEmail.length > 0;
    }
  },
  /** Password-reset link lifetime (ms). */
  passwordResetTtlMs: 30 * 60 * 1000,
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
