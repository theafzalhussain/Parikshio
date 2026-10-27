'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, Gauge, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { AuthAlert, AuthDivider, AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { PasswordField } from '@/components/auth/PasswordField';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';
import { GoogleSignInError, firebaseConfigured } from '@/lib/firebase';
import { ApiError, cx } from '@/lib/api';

const DEMO = {
  admin: { email: 'admin@axiom.edu', password: 'admin123' },
  student: { email: 'aarav@axiom.edu', password: 'student123' }
} as const;

type DemoRole = keyof typeof DEMO;

export default function LoginPage() {
  const router = useRouter();
  const { user, ready, login, loginWithGoogle, sessionNotice, clearSessionNotice } = useAuth();
  const { push } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDemo, setActiveDemo] = useState<DemoRole | null>(null);

  useEffect(() => {
    if (ready && user) router.replace(user.role === 'admin' ? '/admin' : '/student');
  }, [ready, user, router]);

  function fillDemo(role: DemoRole) {
    setActiveDemo(role);
    setEmail(DEMO[role].email);
    setPassword(DEMO[role].password);
    setError(null);
    clearSessionNotice();
  }

  function land(role: 'admin' | 'student', name: string) {
    push({
      kind: 'success',
      title: `Welcome back, ${name.split(' ')[0]}`,
      body: role === 'admin' ? 'Opening the control room…' : 'Opening your exam lobby…'
    });
    router.replace(role === 'admin' ? '/admin' : '/student');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    clearSessionNotice();
    try {
      const authed = await login(email.trim(), password);
      land(authed.role, authed.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign you in right now');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setGoogleBusy(true);
    setError(null);
    clearSessionNotice();
    try {
      const authed = await loginWithGoogle();
      land(authed.role, authed.name);
    } catch (err) {
      // A cancelled popup is a normal user action, not an error worth shouting about.
      if (err instanceof GoogleSignInError && err.cancelled) return;
      setError(
        err instanceof GoogleSignInError || err instanceof ApiError
          ? err.message
          : 'Google sign-in failed. Please try again.'
      );
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Sign in"
      badge={{ tone: 'lime', icon: Sparkles, label: 'live demo seeded' }}
      heading={
        <>
          The exam starts the moment you{' '}
          <span className="font-display italic text-lime-300">press push.</span>
        </>
      }
      subheading="Sign in as faculty to author and broadcast questions, or as a student to receive them with a server-synchronised timer. The same platform, two very different views."
      highlights={[
        { icon: ShieldCheck, text: 'JWT sessions with strict role checks on every route' },
        { icon: Lock, text: 'Students never receive correct answer keys' },
        { icon: Gauge, text: 'Live leaderboard ranked by accuracy, then speed' }
      ]}
      footer={
        <p className="text-center text-[11px] leading-relaxed text-white/25">
          By continuing you agree to the institute&apos;s assessment integrity policy.
        </p>
      }
    >
      <AuthHeading
        title="Welcome back"
        sub="Use a demo account below, or sign in with your own credentials."
      />

      {sessionNotice && (
        <div className="mb-4">
          <AuthAlert tone="warn">{sessionNotice}</AuthAlert>
        </div>
      )}

      {/* demo account shortcuts */}
      <div className="mb-5 grid grid-cols-2 gap-2">
        {(['admin', 'student'] as DemoRole[]).map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => fillDemo(role)}
            className={cx(
              'focus-ring group rounded-2xl border p-3 text-left transition',
              activeDemo === role
                ? 'border-aurora-400/50 bg-aurora-500/[0.1]'
                : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
                {role}
              </span>
              {activeDemo === role && (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-aurora-500 text-white">
                  <Check className="h-2.5 w-2.5" />
                </span>
              )}
            </div>
            <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-white/35">{DEMO[role].email}</p>
          </button>
        ))}
      </div>

      <GoogleButton onClick={google} loading={googleBusy} disabled={busy} configured={firebaseConfigured} />

      <AuthDivider label="or sign in with email" />

      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="login-email">Email address</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@institute.edu"
              className="pl-9"
              required
              autoComplete="email"
            />
          </div>
        </div>

        <PasswordField
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          hint="demo: admin123 / student123"
        />

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="focus-ring rounded text-[12px] text-white/40 transition hover:text-white"
          >
            Forgot password?
          </Link>
        </div>

        {error && <AuthAlert>{error}</AuthAlert>}

        <Button type="submit" size="lg" variant="lime" className="w-full" loading={busy} disabled={googleBusy}>
          Sign in
          {!busy && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="mt-5 text-center text-[12px] text-white/40">
        New here?{' '}
        <Link href="/signup" className="focus-ring rounded font-medium text-lime-300 transition hover:text-lime-200">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
