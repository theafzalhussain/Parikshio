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
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

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
    org: u.org,
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

type AuthFailure = 'missing' | 'invalid' | 'expired' | 'stale' | 'unknown-user';

function failureResponse(kind: AuthFailure): { status: number; error: string; code: string } {
  switch (kind) {
    case 'missing':
      return { status: 401, error: 'Authentication required', code: 'auth/missing' };
    case 'expired':
      return { status: 401, error: 'Your session has expired — please sign in again', code: 'auth/expired' };
    case 'stale':
      return {
        status: 401,
        error: 'Your password was changed — please sign in again',
        code: 'auth/password-changed'
      };
    case 'unknown-user':
      return { status: 401, error: 'Session no longer valid', code: 'auth/unknown-user' };
    default:
      return { status: 401, error: 'Invalid session', code: 'auth/invalid' };
  }
}

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
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    const user = db.userById(payload.sub);
    if (!user) {
      const fail = failureResponse('unknown-user');
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
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    const user = db.userById(payload.sub);
    if (!user) return null;
    if ((payload.v ?? 0) !== (user.tokenVersion ?? 0)) return null;
    return publicUser(user);
  } catch {
    return null;
  }
}
