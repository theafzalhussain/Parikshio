import type { Role } from '@shared/types';

/** The two doors on the sign-in and sign-up pages. "faculty" covers admins too. */
export type AuthRole = 'student' | 'faculty';

/** Reads `?role=` from a URL. Anything unrecognised opens the student tab. */
export function parseAuthRole(raw: unknown): AuthRole {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'faculty' || value === 'admin' ? 'faculty' : 'student';
}

/** Builds an auth page link that keeps the chosen tab and the post-sign-in destination. */
export function authHref(page: '/login' | '/signup', role: AuthRole, next: string | null): string {
  const params = new URLSearchParams();
  if (role === 'faculty') params.set('role', 'faculty');
  if (next) params.set('next', next);
  const query = params.toString();
  return query ? `${page}?${query}` : page;
}

/**
 * A post-sign-in destination is honoured only when it is a path on this site
 * — never "//evil.example" or "https://…" — so `?next=` cannot be used as an
 * open redirect.
 */
export function safeNext(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  if (path.length > 300 || /[\u0000-\u001f\s]/.test(path)) return null;
  return path;
}

/** Where a signed-in user lands: `next` when it belongs to their own area, otherwise their home. */
export function landingFor(role: Role, next: string | null): string {
  const home = role === 'admin' ? '/admin' : '/student';
  if (next && (next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}?`))) return next;
  return home;
}
