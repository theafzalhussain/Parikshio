'use client';

import { ApiError } from './api';
import type { OwnerSignIn } from '@shared/owner';

/**
 * Client for the owner console API. The owner session is separate from a
 * normal Parikshio login: its own token, its own storage key, and it is sent
 * only to /api/owner.
 */
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
const SESSION_KEY = 'parikshio.owner.session';
const EMAIL_KEY = 'parikshio.owner.email';

export function readOwnerSession(): OwnerSignIn | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as OwnerSignIn;
    if (!session?.token || !session.expiresAt || session.expiresAt <= Date.now()) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveOwnerSession(session: OwnerSignIn) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.localStorage.setItem(EMAIL_KEY, session.email);
}

export function clearOwnerSession() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_KEY);
}

/** The address used last time, to save typing it again. */
export function lastOwnerEmail(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(EMAIL_KEY) ?? '';
}

let onSessionLost: ((message: string) => void) | null = null;
/** OwnerApp registers this to show the sign-in screen when the session ends. */
export function setOwnerSessionLostHandler(handler: ((message: string) => void) | null) {
  onSessionLost = handler;
}

export async function ownerApi<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const session = readOwnerSession();
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/owner${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.token}` } : {})
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      cache: 'no-store'
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: res.ok ? undefined : 'Unexpected response from the server' };
    }
  }
  if (!res.ok) {
    const message = typeof data.error === 'string' ? data.error : 'Something went wrong';
    const code = typeof data.code === 'string' ? data.code : undefined;
    if (res.status === 401 && code === 'owner/session') {
      clearOwnerSession();
      onSessionLost?.(message);
    }
    throw new ApiError(message, res.status, code, data);
  }
  return data as T;
}
