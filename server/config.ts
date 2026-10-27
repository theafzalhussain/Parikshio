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
  passwordResetTtlMs: 30 * 60 * 1000
};

export const isProd = isProduction;
