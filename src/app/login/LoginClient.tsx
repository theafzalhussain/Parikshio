'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  CloudOff,
  Gauge,
  GraduationCap,
  KeyRound,
  Lock,
  Mail,
  Presentation,
  Radio
} from 'lucide-react';
import type { PublicUser } from '@shared/types';
import { AuthAlert, AuthDivider, AuthHeading, AuthShell, type AuthHighlight } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { PasswordField } from '@/components/auth/PasswordField';
import { RoleSwitch, rolePanelId, roleTabId, syncRoleToUrl } from '@/components/auth/RoleSwitch';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';
import { GoogleSignInError, firebaseConfigured } from '@/lib/firebase';
import { ApiError, cx, firstName } from '@/lib/api';
import { authHref, landingFor, type AuthRole } from '@/lib/nextPath';
import { SITE_NAME } from '@/lib/site';

type DemoKey = 'admin' | 'student';
type DemoCredentials = Record<DemoKey, { email: string; password: string }>;

function isDemoCredentials(value: unknown): value is DemoCredentials {
  if (!value || typeof value !== 'object') return false;
  const credentials = value as Record<string, unknown>;
  return (['admin', 'student'] as const).every((role) => {
    const account = credentials[role];
    if (!account || typeof account !== 'object') return false;
    const fields = account as Record<string, unknown>;
    return typeof fields.email === 'string' && typeof fields.password === 'string';
  });
}

const PANEL: Record<
  AuthRole,
  {
    badge: { tone: 'gold' | 'royal'; icon: React.ComponentType<{ className?: string }>; label: string };
    heading: React.ReactNode;
    subheading: string;
    highlights: AuthHighlight[];
    title: string;
    sub: string;
  }
> = {
  student: {
    badge: { tone: 'gold', icon: GraduationCap, label: 'Student log in' },
    heading: (
      <>
        Your next exam is <span className="font-display italic gold-text">one code away.</span>
      </>
    ),
    subheading:
      'Log in to join live exams with the code your teacher shares, answer against a fair server-synced timer and see how you did.',
    highlights: [
      { icon: KeyRound, text: 'Join any live session with the code your teacher shares' },
      { icon: CloudOff, text: 'If your connection drops, answers stay on your device and are sent when you are back online' },
      { icon: BarChart3, text: 'See your scores and the topics worth practising after every session' }
    ],
    title: 'Welcome back',
    sub: 'Log in to your student account.'
  },
  faculty: {
    badge: { tone: 'royal', icon: Presentation, label: 'Faculty & admin' },
    heading: (
      <>
        The exam starts the moment you <span className="font-display italic gold-text">press push.</span>
      </>
    ),
    subheading:
      'Author questions, push them to every student on one timer, and watch answers arrive and get graded as they land.',
    highlights: [
      { icon: Radio, text: 'Push one question or a whole paper with a server-synced timer' },
      { icon: Lock, text: 'Answer keys stay on the server and never reach a student device' },
      { icon: Gauge, text: 'Live leaderboard ranked by accuracy, then speed' }
    ],
    title: 'Faculty log in',
    sub: 'Use the faculty account created for you.'
  }
};

export function LoginClient({ initialRole, next }: { initialRole: AuthRole; next: string | null }) {
  const router = useRouter();
  const showDemoAccounts = process.env.NODE_ENV !== 'production';
  const { user, ready, login, loginWithGoogle, sessionNotice, clearSessionNotice } = useAuth();
  const { push } = useToast();

  const [role, setRole] = useState<AuthRole>(initialRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoFilled, setDemoFilled] = useState(false);
  const [demoCredentials, setDemoCredentials] = useState<DemoCredentials | null>(null);
  const [demoLoadError, setDemoLoadError] = useState(false);

  const panel = PANEL[role];
  const demoKey: DemoKey = role === 'faculty' ? 'admin' : 'student';

  useEffect(() => {
    if (ready && user) router.replace(landingFor(user.role, next));
  }, [ready, user, router, next]);

  useEffect(() => {
    if (!showDemoAccounts) return;
    let active = true;

    async function loadDemoAccounts() {
      try {
        const response = await fetch('/api/auth/demo');
        if (!response.ok) throw new Error('Demo accounts are unavailable.');
        const credentials: unknown = await response.json();
        if (!isDemoCredentials(credentials)) throw new Error('Invalid demo account response.');
        if (active) setDemoCredentials(credentials);
      } catch {
        if (active) setDemoLoadError(true);
      }
    }

    void loadDemoAccounts();
    return () => {
      active = false;
    };
  }, [showDemoAccounts]);

  function changeRole(nextRole: AuthRole) {
    if (nextRole === role) return;
    setRole(nextRole);
    setError(null);
    setDemoFilled(false);
    syncRoleToUrl(nextRole);
  }

  function fillDemo(credentials: DemoCredentials) {
    setDemoFilled(true);
    setEmail(credentials[demoKey].email);
    setPassword(credentials[demoKey].password);
    setError(null);
    clearSessionNotice();
  }

  /** Signs the user into their own area, saying so when it differs from the tab they picked. */
  function land(authed: PublicUser) {
    const greeting = firstName(authed.name);
    const expected = role === 'faculty' ? 'admin' : 'student';
    const otherArea =
      authed.role === 'admin'
        ? 'This is a faculty account, so we opened the faculty console.'
        : 'This is a student account, so we opened your exam lobby.';
    push({
      kind: 'success',
      title: `Welcome back, ${greeting}`,
      body:
        authed.role !== expected
          ? otherArea
          : authed.role === 'admin'
            ? 'Opening the faculty console…'
            : 'Opening your exam lobby…'
    });
    router.replace(landingFor(authed.role, next));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    clearSessionNotice();
    try {
      land(await login(email.trim(), password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not log you in right now');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setGoogleBusy(true);
    setError(null);
    clearSessionNotice();
    try {
      // The faculty tab never creates accounts: an unknown Google address is
      // refused instead of quietly becoming a new student.
      land(await loginWithGoogle(role === 'faculty' ? { mode: 'signin' } : undefined));
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
      eyebrow="Log in"
      badge={panel.badge}
      heading={panel.heading}
      subheading={panel.subheading}
      highlights={panel.highlights}
      panelKey={role}
      footer={
        <p className="text-center text-[12px] leading-relaxed text-white/40">
          By continuing you agree to the {SITE_NAME}{' '}
          <Link href="/terms" className="focus-ring rounded underline-offset-2 transition hover:text-white/70 hover:underline">
            Terms of use
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="focus-ring rounded underline-offset-2 transition hover:text-white/70 hover:underline">
            Privacy policy
          </Link>
          .
        </p>
      }
    >
      <RoleSwitch idBase="login" label="Log in as" value={role} onChange={changeRole} className="mb-8" />

      <div role="tabpanel" id={rolePanelId('login')} aria-labelledby={roleTabId('login', role)}>
        <AuthHeading title={panel.title} sub={panel.sub} />

        {sessionNotice && (
          <div className="mb-4">
            <AuthAlert tone="warn">{sessionNotice}</AuthAlert>
          </div>
        )}

        {showDemoAccounts && demoCredentials && (
          <button
            type="button"
            onClick={() => fillDemo(demoCredentials)}
            className={cx(
              'focus-ring mb-5 flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-left transition',
              demoFilled
                ? 'border-royal-400/50 bg-royal-500/[0.1]'
                : 'border-dashed border-white/[0.14] bg-white/[0.02] hover:border-white/25'
            )}
          >
            <span className="min-w-0">
              <span className="block text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/70">
                Demo {role === 'faculty' ? 'faculty' : 'student'} · local only
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11.5px] text-white/50">
                {demoCredentials[demoKey].email}
              </span>
            </span>
            {demoFilled ? (
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-royal-500 text-white">
                <Check className="h-3 w-3" />
              </span>
            ) : (
              <span className="shrink-0 text-[12px] font-medium text-gold-200">Fill in</span>
            )}
          </button>
        )}
        {showDemoAccounts && demoLoadError && (
          <div className="mb-5">
            <AuthAlert tone="warn">Development demo accounts could not be loaded.</AuthAlert>
          </div>
        )}

        <GoogleButton onClick={google} loading={googleBusy} disabled={busy} configured={firebaseConfigured} />

        <AuthDivider label="or log in with email" />

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="login-email">Email address</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={role === 'faculty' ? 'you@institute.edu' : 'you@example.com'}
                className="pl-9"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />

          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="focus-ring rounded text-[13px] text-white/55 transition hover:text-white"
            >
              Forgot password?
            </Link>
          </div>

          {error && <AuthAlert>{error}</AuthAlert>}

          <Button type="submit" size="lg" variant="gold" className="w-full" loading={busy} disabled={googleBusy}>
            Log in
            {!busy && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>

        {role === 'student' ? (
          <p className="mt-6 text-center text-[13px] text-white/55">
            New to {SITE_NAME}?{' '}
            <Link
              href={authHref('/signup', 'student', next)}
              className="focus-ring rounded font-medium text-gold-300 transition hover:text-gold-200"
            >
              Create a student account
            </Link>
          </p>
        ) : (
          <p className="mt-6 text-center text-[13px] leading-relaxed text-white/55">
            Need a faculty account?{' '}
            <Link
              href="/contact?topic=faculty"
              className="focus-ring rounded font-medium text-gold-300 transition hover:text-gold-200"
            >
              Request access
            </Link>
          </p>
        )}
      </div>
    </AuthShell>
  );
}
