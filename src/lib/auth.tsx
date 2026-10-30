'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicUser } from '@shared/types';
import { api, ApiError, setSessionLostHandler, setToken, wakeServer } from './api';
import { getGoogleIdToken } from './firebaseConfig';

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  org: string;
}

/** Which log-in tab a sign-in came from. */
export type LoginPortal = 'student' | 'faculty';

interface AuthState {
  user: PublicUser | null;
  token: string | null;
  ready: boolean;
  /** Set when a session was dropped (expired / password changed) so pages can explain why. */
  sessionNotice: string | null;
  clearSessionNotice: () => void;
  /** `portal` is the log-in tab: the server refuses an account of the other kind. */
  login: (email: string, password: string, portal?: LoginPortal) => Promise<PublicUser>;
  register: (payload: RegisterPayload) => Promise<PublicUser>;
  /**
   * Runs the Google popup, exchanges the ID token for a Parikshio session.
   * `mode: 'signin'` refuses to create a new account for an unknown address.
   */
  loginWithGoogle: (opts?: { org?: string; mode?: 'signin'; portal?: LoginPortal }) => Promise<PublicUser>;
  requestPasswordReset: (email: string) => Promise<{ message: string; devLink?: string }>;
  resetPassword: (token: string, password: string) => Promise<PublicUser>;
  changePassword: (currentPassword: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
const TOKEN_KEY = 'axiom.token';
const USER_KEY = 'axiom.user';

interface SessionResponse {
  token: string;
  user: PublicUser;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  /** Guards against the session-lost handler firing repeatedly. */
  const clearingRef = useRef(false);

  const clearSession = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
    }
  }, []);

  // One place decides what happens when the server says our token is dead.
  useEffect(() => {
    setSessionLostHandler((reason) => {
      if (clearingRef.current) return;
      clearingRef.current = true;
      clearSession();
      setSessionNotice(reason);
      window.setTimeout(() => {
        clearingRef.current = false;
      }, 1000);
    });
  }, [clearSession]);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null;
    const storedUser = typeof window !== 'undefined' ? window.localStorage.getItem(USER_KEY) : null;
    if (!stored) {
      // Nobody signed in yet: wake the API now, so their log-in is quick.
      wakeServer();
      setReady(true);
      return;
    }

    setToken(stored);
    setTokenState(stored);
    let cached: PublicUser | null = null;
    if (storedUser) {
      try {
        cached = JSON.parse(storedUser) as PublicUser;
        setUser(cached);
      } catch {
        /* corrupt cache — the /auth/me call below is the source of truth */
      }
    }
    // With a cached account the panel opens at once instead of waiting a full
    // round trip to the server. Every data request still carries the token, so
    // nothing private loads unless the server accepts it; if the session turns
    // out to be dead, the check below signs the person out.
    if (cached?.id && cached.role) setReady(true);

    api<{ user: PublicUser }>('/auth/me', { skipAuthRedirect: true })
      .then((res) => {
        setUser(res.user);
        window.localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      })
      .catch((err: unknown) => {
        // Only a rejected session signs the person out. A network blip, or the
        // server still waking up, must not throw away a valid sign-in.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) clearSession();
        else if (!cached) clearSession();
      })
      .finally(() => setReady(true));
  }, [clearSession]);

  const persist = useCallback((nextToken: string, nextUser: PublicUser) => {
    setToken(nextToken);
    setTokenState(nextToken);
    setUser(nextUser);
    setSessionNotice(null);
    window.localStorage.setItem(TOKEN_KEY, nextToken);
    window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  }, []);

  const login = useCallback(
    async (email: string, password: string, portal?: LoginPortal) => {
      const res = await api<SessionResponse>('/auth/login', {
        method: 'POST',
        body: { email, password, portal },
        skipAuthRedirect: true
      });
      persist(res.token, res.user);
      return res.user;
    },
    [persist]
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const res = await api<SessionResponse>('/auth/register', {
        method: 'POST',
        body: payload,
        skipAuthRedirect: true
      });
      persist(res.token, res.user);
      return res.user;
    },
    [persist]
  );

  const loginWithGoogle = useCallback(
    async (opts?: { org?: string; mode?: 'signin'; portal?: LoginPortal }) => {
      // Popup first — if the user cancels we never touch our own backend.
      const idToken = await getGoogleIdToken();
      const res = await api<SessionResponse & { created: boolean }>('/auth/google', {
        method: 'POST',
        body: { idToken, org: opts?.org, mode: opts?.mode, portal: opts?.portal },
        skipAuthRedirect: true
      });
      persist(res.token, res.user);
      return res.user;
    },
    [persist]
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    return api<{ ok: true; message: string; devLink?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      skipAuthRedirect: true
    });
  }, []);

  const resetPassword = useCallback(
    async (resetToken: string, password: string) => {
      const res = await api<SessionResponse>('/auth/reset-password', {
        method: 'POST',
        body: { token: resetToken, password },
        skipAuthRedirect: true
      });
      persist(res.token, res.user);
      return res.user;
    },
    [persist]
  );

  const changePassword = useCallback(
    async (currentPassword: string, password: string) => {
      // The server revokes every other session, so we adopt the fresh token.
      const res = await api<SessionResponse>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, password }
      });
      persist(res.token, res.user);
    },
    [persist]
  );

  const logout = useCallback(() => {
    clearSession();
    setSessionNotice(null);
  }, [clearSession]);

  const clearSessionNotice = useCallback(() => setSessionNotice(null), []);

  const value = useMemo(
    () => ({
      user,
      token,
      ready,
      sessionNotice,
      clearSessionNotice,
      login,
      register,
      loginWithGoogle,
      requestPasswordReset,
      resetPassword,
      changePassword,
      logout
    }),
    [
      user,
      token,
      ready,
      sessionNotice,
      clearSessionNotice,
      login,
      register,
      loginWithGoogle,
      requestPasswordReset,
      resetPassword,
      changePassword,
      logout
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
