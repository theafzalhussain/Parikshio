'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  GraduationCap,
  Mail,
  Rocket,
  ShieldCheck,
  User,
  Zap
} from 'lucide-react';
import { AuthAlert, AuthDivider, AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { PasswordField, passwordIssues } from '@/components/auth/PasswordField';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';
import { GoogleSignInError, firebaseConfigured } from '@/lib/firebase';
import { ApiError } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const { user, ready, register, loginWithGoogle } = useAuth();
  const { push } = useToast();

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
      const authed = await loginWithGoogle({ org: org.trim() || undefined });
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
      subheading="Create a student account to join live timed sessions. Faculty accounts are provisioned by an institute administrator."
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
      <AuthHeading title="Join Parikshio" sub="Create a student account to join your institute's live assessments." />

      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-aurora-500/20 text-aurora-100">
          <GraduationCap className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[12.5px] font-semibold text-white/85">Student account</p>
          <p className="text-[11px] text-white/35">Faculty access is provisioned by your institute administrator.</p>
        </div>
      </div>

      <GoogleButton
        onClick={google}
        loading={googleBusy}
        disabled={busy}
        configured={firebaseConfigured}
        label="Sign up with Google as a student"
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
              placeholder="e.g. Aarav Gupta"
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
          Create student account
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
