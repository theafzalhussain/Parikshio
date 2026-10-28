const TOKEN_KEY = 'axiom.token';
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

let bearer: string | null = null;

export function setToken(token: string | null) {
  bearer = token;
  if (typeof window !== 'undefined') {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  }
}

export function getToken(): string | null {
  if (bearer) return bearer;
  if (typeof window !== 'undefined') {
    bearer = window.localStorage.getItem(TOKEN_KEY);
    return bearer;
  }
  return null;
}

export class ApiError extends Error {
  status: number;
  /** Machine-readable reason, e.g. `auth/expired`. Present on auth failures. */
  code?: string;
  /**
   * The full parsed error body. Some endpoints attach extra context beyond the
   * message (the paper upload returns `warnings` and `previewText`), and losing
   * it would mean the UI can only show a bare error.
   */
  details?: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the global "session died" handler — used by the auth screens themselves. */
  skipAuthRedirect?: boolean;
}

/**
 * Called when the server rejects our token (expired, revoked, or the password
 * changed elsewhere). AuthProvider registers the real handler.
 */
let onSessionLost: ((reason: string) => void) | null = null;
export function setSessionLostHandler(handler: (reason: string) => void) {
  onSessionLost = handler;
}

const SESSION_DEAD_CODES = new Set([
  'auth/expired',
  'auth/invalid',
  'auth/password-changed',
  'auth/unknown-user'
]);

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_ORIGIN}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    cache: 'no-store'
  });

  return unwrap<T>(res, 'Something went wrong', options.skipAuthRedirect);
}

/** POST helper for multipart uploads (the JSON helper can't carry FormData). */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_ORIGIN}/api${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
    cache: 'no-store'
  });
  return unwrap<T>(res, 'Upload failed');
}

/**
 * Shared response handling for both helpers: tolerant JSON parsing, a typed
 * ApiError, and the single place that notices a dead session.
 */
async function unwrap<T>(res: Response, fallbackMessage: string, skipAuthRedirect = false): Promise<T> {
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      // Non-JSON error bodies (proxy pages, HTML error screens) shouldn't crash the client.
      data = { error: res.ok ? undefined : 'Unexpected response from the server' };
    }
  }

  if (!res.ok) {
    const payload = data as { error?: string; code?: string };
    const message = payload.error ?? fallbackMessage;
    const code = payload.code;

    if (res.status === 401 && code && SESSION_DEAD_CODES.has(code) && !skipAuthRedirect) {
      onSessionLost?.(message);
    }
    throw new ApiError(message, res.status, code, data as Record<string, unknown>);
  }
  return data as T;
}

export function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function initials(name: string): string {
  return name
    .replace(/^Dr\.\s*|^Faculty\s*·\s*/, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
