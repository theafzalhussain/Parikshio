import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { config } from './config';
import { db } from './store';
import type { StoredUser } from './store';
import type { PublicUser, Role } from '../shared/types';

const BCRYPT_ROUNDS = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  // Google-only accounts have no password hash — never let an empty hash match.
  if (!hash) return false;
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Non-blocking versions for request handlers. bcrypt is deliberately slow
 * (tens of milliseconds per check); the async form yields to the event loop
 * while it works, so one sign-in never stalls every other student's request
 * or a live exam's socket traffic.
 */
export function hashPasswordAsync(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPasswordAsync(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  const proof = verifiedProof(plain, hash);
  const known = verifiedLogins.get(hash);
  if (known && known.expiresAt > Date.now() && crypto.timingSafeEqual(known.proof, proof)) return true;
  try {
    const ok = await bcrypt.compare(plain, hash);
    if (ok) rememberVerified(hash, proof);
    return ok;
  } catch {
    return false;
  }
}

/*
 * Fast repeat sign-ins. bcrypt costs a few hundred milliseconds per check, and
 * far more on a small shared host CPU, so every log-in waited on it. Once a
 * password has passed bcrypt, an HMAC of it (keyed with a random secret that
 * exists only in this process's memory, never stored or logged) is kept against
 * that exact hash. The next correct sign-in matches the HMAC in microseconds.
 *
 * Nothing gets weaker: a wrong password never matches and still pays the full
 * bcrypt check, so guessing is exactly as slow as before. Changing or resetting
 * a password writes a new hash, which no entry matches. The plain password is
 * never kept.
 */
const VERIFIED_TTL_MS = 12 * 60 * 60 * 1000;
const VERIFIED_MAX = 5000;
const verifiedKey = crypto.randomBytes(32);
const verifiedLogins = new Map<string, { proof: Buffer; expiresAt: number }>();

function verifiedProof(plain: string, hash: string): Buffer {
  return crypto.createHmac('sha256', verifiedKey).update(hash).update('\0').update(plain).digest();
}

function rememberVerified(hash: string, proof: Buffer) {
  // Re-inserting keeps the Map in least-recently-verified order, so the oldest goes first.
  verifiedLogins.delete(hash);
  if (verifiedLogins.size >= VERIFIED_MAX) {
    const oldest = verifiedLogins.keys().next().value;
    if (oldest !== undefined) verifiedLogins.delete(oldest);
  }
  verifiedLogins.set(hash, { proof, expiresAt: Date.now() + VERIFIED_TTL_MS });
}

/** A real hash of a random secret: comparing against it costs the same time as a real check. */
const TIMING_DECOY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

/**
 * Spends the same time as a real password check. Used when the email is
 * unknown, so the reply time does not reveal which addresses have accounts.
 */
export async function burnPasswordCheck(plain: string): Promise<void> {
  await verifyPasswordAsync(plain, TIMING_DECOY_HASH);
}

/** Session tokens are HS256 only; pinning the algorithm closes off algorithm-confusion tricks. */
const JWT_ALGORITHMS: jwt.Algorithm[] = ['HS256'];

interface TokenPayload {
  sub: string;
  role: Role;
  /** Session generation — must match the user's current tokenVersion. */
  v: number;
}

export function signToken(user: PublicUser, tokenVersion = 0): string {
  const payload: TokenPayload = { sub: user.id, role: user.role, v: tokenVersion };
  // `expiresIn` is typed as a template-literal duration; config carries a plain
  // string from the environment, so it is narrowed here.
  const expiresIn = config.sessionTtl as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, config.jwtSecret, { expiresIn, algorithm: 'HS256' });
}

/**
 * The placeholder institute older sign-ups were given when they left the field
 * blank. It is hidden in every response rather than rewritten in the database.
 */
const LEGACY_PLACEHOLDER_ORG = 'Axiom Institute';

export function publicUser(u: {
  id: string;
  name: string;
  email: string;
  role: Role;
  org: string;
  avatarUrl?: string;
}): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    org: u.org === LEGACY_PLACEHOLDER_ORG ? '' : u.org,
    ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {})
  };
}

/** Issues a session for a stored user, stamped with their current token version. */
export function issueSession(user: StoredUser): { token: string; user: PublicUser } {
  const pub = publicUser(user);
  return { token: signToken(pub, user.tokenVersion ?? 0), user: pub };
}

export interface AuthedRequest extends Request {
  user?: PublicUser;
}

type AuthFailure = 'missing' | 'invalid' | 'expired' | 'stale' | 'unknown-user' | 'suspended';

function failureResponse(kind: AuthFailure): { status: number; error: string; code: string } {
  switch (kind) {
    case 'missing':
      return { status: 401, error: 'Authentication required', code: 'auth/missing' };
    case 'expired':
      return { status: 401, error: 'Your session has expired — please log in again', code: 'auth/expired' };
    case 'stale':
      return {
        status: 401,
        error: 'Your password was changed — please log in again',
        code: 'auth/password-changed'
      };
    case 'unknown-user':
      return { status: 401, error: 'Session no longer valid', code: 'auth/unknown-user' };
    case 'suspended':
      return { status: 401, error: SUSPENDED_MESSAGE, code: 'auth/suspended' };
    default:
      return { status: 401, error: 'Invalid session', code: 'auth/invalid' };
  }
}

/** Shown wherever a suspended account tries to get in. */
export const SUSPENDED_MESSAGE = `This account is suspended. If you think this is a mistake, write to ${config.contact.inbox}.`;

export function authenticate(req: AuthedRequest, res: ExpressResponse, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  // Header only, deliberately: a session JWT in the query string would leak into
  // proxy/CDN access logs, Referer headers and browser history. Sockets pass it
  // through `handshake.auth.token` instead.
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    const fail = failureResponse('missing');
    return res.status(fail.status).json({ error: fail.error, code: fail.code });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: JWT_ALGORITHMS }) as TokenPayload;
    const user = db.userById(payload.sub);
    if (!user) {
      const fail = failureResponse('unknown-user');
      return res.status(fail.status).json({ error: fail.error, code: fail.code });
    }
    // Checked before the version so the person is told why, not "password changed".
    if (user.suspended) {
      const fail = failureResponse('suspended');
      return res.status(fail.status).json({ error: fail.error, code: fail.code });
    }
    // Reject sessions minted before the last password change.
    if ((payload.v ?? 0) !== (user.tokenVersion ?? 0)) {
      const fail = failureResponse('stale');
      return res.status(fail.status).json({ error: fail.error, code: fail.code });
    }
    req.user = publicUser(user);
    next();
  } catch (err) {
    const kind: AuthFailure = (err as Error)?.name === 'TokenExpiredError' ? 'expired' : 'invalid';
    const fail = failureResponse(kind);
    return res.status(fail.status).json({ error: fail.error, code: fail.code });
  }
}

export function requireRole(role: Role) {
  return (req: AuthedRequest, res: ExpressResponse, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required', code: 'auth/missing' });
    if (req.user.role !== role) {
      return res.status(403).json({ error: `Requires ${role} role`, code: 'auth/forbidden' });
    }
    next();
  };
}

/** Verifies a socket handshake token. Returns the user or null. */
export function userFromToken(token: string): PublicUser | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: JWT_ALGORITHMS }) as TokenPayload;
    const user = db.userById(payload.sub);
    if (!user || user.suspended) return null;
    if ((payload.v ?? 0) !== (user.tokenVersion ?? 0)) return null;
    return publicUser(user);
  } catch {
    return null;
  }
}
