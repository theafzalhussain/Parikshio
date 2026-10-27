import jwt from 'jsonwebtoken';
import { config } from './config';

/**
 * Firebase ID-token verification.
 *
 * Google sign-in happens entirely in the browser (Firebase Web SDK). The client
 * then sends the resulting ID token here, and this module proves the token is
 * genuine before we trust a single claim inside it.
 *
 * We verify against Google's published x509 certificates rather than pulling in
 * `firebase-admin`, so no service-account JSON needs to live on the server —
 * only the (public) project id.
 */

const CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}

let cache: CertCache | null = null;
let inFlight: Promise<Record<string, string>> | null = null;

function maxAgeFrom(header: string | null): number {
  const match = header ? /max-age=(\d+)/.exec(header) : null;
  const seconds = match ? Number(match[1]) : 3600;
  // Clamp so a bad header can neither hammer Google nor pin stale keys for days.
  return Math.min(Math.max(seconds, 300), 24 * 3600) * 1000;
}

async function fetchCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.certs;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(CERT_URL, { signal: controller.signal });
      if (!res.ok) throw new Error(`certificate endpoint returned ${res.status}`);
      const certs = (await res.json()) as Record<string, string>;
      cache = { certs, expiresAt: Date.now() + maxAgeFrom(res.headers.get('cache-control')) };
      return certs;
    } finally {
      clearTimeout(timeout);
      inFlight = null;
    }
  })();

  return inFlight;
}

export interface GoogleIdentity {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
}

export type VerifyResult =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; error: string };

interface FirebaseClaims {
  sub?: string;
  aud?: string;
  iss?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  exp?: number;
  auth_time?: number;
  firebase?: { sign_in_provider?: string };
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifyResult> {
  if (!config.firebase.enabled) {
    return { ok: false, error: 'Google sign-in is not configured on this server' };
  }
  if (!idToken || idToken.split('.').length !== 3) {
    return { ok: false, error: 'Malformed Google sign-in token' };
  }

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    return { ok: false, error: 'Could not read the Google sign-in token' };
  }

  const { kid, alg } = decoded.header;
  if (alg !== 'RS256') return { ok: false, error: 'Unexpected token algorithm' };
  if (!kid) return { ok: false, error: 'Token is missing a key id' };

  let certs: Record<string, string>;
  try {
    certs = await fetchCerts();
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach Google to verify the sign-in (${(err as Error).message.slice(0, 80)})`
    };
  }

  const cert = certs[kid];
  if (!cert) {
    // Key rotation: drop the cache once and retry with fresh certs.
    cache = null;
    try {
      const fresh = await fetchCerts();
      if (!fresh[kid]) return { ok: false, error: 'Google sign-in key not recognised' };
      certs = fresh;
    } catch {
      return { ok: false, error: 'Google sign-in key not recognised' };
    }
  }

  const projectId = config.firebase.projectId;
  let claims: FirebaseClaims;
  try {
    claims = jwt.verify(idToken, certs[kid]!, {
      algorithms: ['RS256'],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      clockTolerance: 10
    }) as FirebaseClaims;
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'TokenExpiredError') {
      return { ok: false, error: 'Google sign-in expired — please try again' };
    }
    return { ok: false, error: 'Google sign-in could not be verified' };
  }

  if (!claims.sub) return { ok: false, error: 'Google sign-in token has no subject' };
  const email = (claims.email ?? '').trim().toLowerCase();
  if (!email) {
    return { ok: false, error: 'Your Google account did not share an email address' };
  }

  return {
    ok: true,
    identity: {
      googleId: claims.sub,
      email,
      emailVerified: claims.email_verified === true,
      name: (claims.name ?? '').trim() || email.split('@')[0]!,
      picture: (claims.picture ?? '').trim()
    }
  };
}
