'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  GraduationCap,
  Mail,
  Presentation,
  Rocket,
  ShieldCheck,
  User,
  Zap
} from 'lucide-react';
import type { Role } from '@shared/types';
import { AuthAlert, AuthDivider, AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { PasswordField, passwordIssues } from '@/components/auth/PasswordField';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';
import { GoogleSignInError, firebaseConfigured } from '@/lib/firebase';
import { ApiError, cx } from '@/lib/api';

const ROLE_CARDS: {
  value: Role;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: 'admin',
    label: 'Faculty',
    blurb: 'Author questions, run live sessions, read analytics',
    icon: Presentation
  },
  {
    value: 'student',
    label: 'Student',
    blurb: 'Join sessions with a code and answer in real time',
    icon: GraduationCap
  }
];

export default function SignupPage() {
  const router = useRouter();
  const { user, ready, register, loginWithGoogle } = useAuth();
  const { push } = useToast();

  const [role, setRole] = useState<Role>('admin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && user) router.replace(user.role === 'admin' ? '/admin' : '/student');
  }, [ready, user, router]);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = useMemo(
    () =>
      name.trim().length > 0 &&
      email.trim().length > 0 &&
      passwordIssues(password).length === 0 &&
      confirm === password,
    [name, email, password, confirm]
  );

  function land(nextRole: 'admin' | 'student', displayName: string, created: boolean) {
    push({
      kind: 'success',
      title: created ? 'Account created' : `Welcome back, ${displayName.split(' ')[0]}`,
      body: nextRole === 'admin' ? 'Opening the control room…' : 'Opening your exam lobby…'
    });
    router.replace(nextRole === 'admin' ? '/admin' : '/student');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const issues = passwordIssues(password);
    if (issues.length) {
      setError(issues[0]!);
      return;
    }
    if (password !== confirm) {
      setError('Both passwords must match');
      return;
    }

    setBusy(true);
    try {
      const authed = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        org: org.trim() || undefined
      });
      land(authed.role, authed.name, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account right now');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setGoogleBusy(true);
    setError(null);
    try {
      // The chosen role + institute are applied only if this is a brand-new account.
      const authed = await loginWithGoogle({ role, org: org.trim() || undefined });
      land(authed.role, authed.name, true);
    } catch (err) {
      if (err instanceof GoogleSignInError && err.cancelled) return;
      setError(
        err instanceof GoogleSignInError || err instanceof ApiError
          ? err.message
          : 'Google sign-up failed. Please try again.'
      );
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Create account"
      badge={{ tone: 'violet', icon: Rocket, label: 'free to start' }}
      heading={
        <>
          Set up your institute in{' '}
          <span className="font-display italic text-lime-300">under a minute.</span>
        </>
      }
      subheading="Create a faculty account to build question banks and run live timed sessions, or a student account to join them. You can switch institutes later."
      highlights={[
        { icon: Zap, text: 'Upload a PDF, Word file or photo — questions are extracted for you' },
        { icon: ShieldCheck, text: 'Passwords are hashed with bcrypt; answer keys stay server-side' },
        { icon: Building2, text: 'Works for a single classroom or an entire college' }
      ]}
      footer={
        <p className="text-center text-[11px] leading-relaxed text-white/25">
          By creating an account you agree to the institute&apos;s assessment integrity policy.
        </p>
      }
    >
      <AuthHeading title="Join Axiom Live" sub="Pick the role that matches how you will use the platform." />

      {/* role picker */}
      <div className="mb-5 grid gap-2 sm:grid-cols-2">
        {ROLE_CARDS.map((card) => {
          const selected = role === card.value;
          return (
            <button
              key={card.value}
              type="button"
              onClick={() => setRole(card.value)}
              aria-pressed={selected}
              className={cx(
                'focus-ring rounded-2xl border p-3 text-left transition',
                selected
                  ? 'border-aurora-400/50 bg-aurora-500/[0.1]'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
              )}
            >
              <span
                className={cx(
                  'grid h-7 w-7 place-items-center rounded-lg ring-1 ring-inset transition',
                  selected
                    ? 'bg-aurora-500/20 text-aurora-100 ring-aurora-400/30'
                    : 'bg-white/[0.05] text-white/45 ring-white/10'
                )}
              >
                <card.icon className="h-3.5 w-3.5" />
              </span>
              <p className="mt-2 text-[12.5px] font-semibold text-white/85">{card.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">{card.blurb}</p>
            </button>
          );
        })}
      </div>

      <GoogleButton
        onClick={google}
        loading={googleBusy}
        disabled={busy}
        configured={firebaseConfigured}
        label={`Sign up with Google as ${role === 'admin' ? 'faculty' : 'student'}`}
      />

      <AuthDivider label="or use email" />

      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="signup-name">Full name</Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
            <Input
              id="signup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={role === 'admin' ? 'e.g. Dr. Meera Sharma' : 'e.g. Aarav Gupta'}
              className="pl-9"
              required
              autoComplete="name"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="signup-email">Email address</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
            <Input
              id="signup-email"
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

        <div>
          <Label hint="optional" htmlFor="signup-org">Institute / cohort</Label>
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
            <Input
              id="signup-org"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="Axiom Institute of Technology"
              className="pl-9"
              autoComplete="organization"
            />
          </div>
        </div>

        <PasswordField
          value={password}
          onChange={setPassword}
          label="Create password"
          autoComplete="new-password"
          showStrength
        />

        <div>
          <PasswordField
            value={confirm}
            onChange={setConfirm}
            label="Confirm password"
            placeholder="Re-enter your password"
            autoComplete="new-password"
          />
          {mismatch && <p className="mt-1.5 text-[11px] text-ember-400">Passwords do not match</p>}
        </div>

        {error && <AuthAlert>{error}</AuthAlert>}

        <Button
          type="submit"
          size="lg"
          variant="lime"
          className="w-full"
          loading={busy}
          disabled={googleBusy || !canSubmit}
        >
          Create {role === 'admin' ? 'faculty' : 'student'} account
          {!busy && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="mt-5 text-center text-[12px] text-white/40">
        Already have an account?{' '}
        <Link href="/login" className="focus-ring rounded font-medium text-lime-300 transition hover:text-lime-200">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
