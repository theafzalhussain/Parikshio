'use client';

import { useEffect, useState } from 'react';
import { ShellGate } from '@/components/ShellGate';
import { clearOwnerSession, ownerApi, readOwnerSession, setOwnerSessionLostHandler } from '@/lib/owner';
import type { OwnerSignIn } from '@shared/owner';
import { OwnerLogin } from './OwnerLogin';
import { OwnerShell } from './OwnerShell';

/** Root of /hq: the sign-in screen until there is a valid owner session, then the console. */
export function OwnerApp() {
  const [session, setSession] = useState<OwnerSignIn | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSession(readOwnerSession());
    setReady(true);
    setOwnerSessionLostHandler((message) => {
      setSession(null);
      setNotice(message);
    });
    return () => setOwnerSessionLostHandler(null);
  }, []);

  // The token stops working on the server at this moment; leave at the same time.
  useEffect(() => {
    if (!session) return;
    const t = window.setTimeout(() => {
      clearOwnerSession();
      setSession(null);
      setNotice('Your owner sign-in expired after 12 hours. Sign in again.');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [session]);

  if (!ready) return <ShellGate label="Opening the owner console…" />;
  if (!session) {
    return (
      <OwnerLogin
        notice={notice}
        onSignedIn={(s) => {
          setNotice(null);
          setSession(s);
        }}
      />
    );
  }
  return (
    <OwnerShell
      email={session.email}
      onSignOut={() => {
        void ownerApi('/auth/logout', { method: 'POST' }).catch(() => undefined);
        clearOwnerSession();
        setSession(null);
        setNotice('You are signed out of the owner console.');
      }}
    />
  );
}
