'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ArrowRight, KeyRound, Link2Off, LogOut, ShieldCheck, Clock } from 'lucide-react';
import { AuthAlert, AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { PasswordField, passwordIssues } from '@/components/auth/PasswordField';
import { Button, LinkButton } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { resetPassword } = useAuth();
  const { push } = useToast();

  const token = params.get('token') ?? '';
  const email = params.get('email') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = useMemo(
    () => passwordIssues(password).length === 0 && confirm === password,
    [password, confirm]
  );

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
      // A successful reset returns a fresh session, so the user lands signed in.
      const authed = await resetPassword(token, password);
      push({
        kind: 'success',
        title: 'Password updated',
        body: 'Every other device has been signed out.'
      });
      router.replace(authed.role === 'admin' ? '/admin' : '/student');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password right now');
    } finally {
      setBusy(false);
    }
  }

  // A missing token means the user opened this page directly rather than via a link.
  if (!token) {
    return (
      <>
        <AuthHeading
          title="This link is incomplete"
          sub="Password reset links must be opened exactly as they arrive in your email."
        />
        <div className="rounded-2xl border border-ember-500/25 bg-ember-500/[0.06] p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-ember-500/15 text-ember-400 ring-1 ring-inset ring-ember-500/25">
              <Link2Off className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-white/85">No reset token found</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/45">
                Request a fresh link and open it from your inbox — tokens expire after 30 minutes and work only
                once.
              </p>
            </div>
          </div>
        </div>
        <LinkButton href="/forgot-password" variant="lime" size="lg" className="mt-5 w-full">
          Request a new link
          <ArrowRight className="h-4 w-4" />
        </LinkButton>
        <p className="mt-5 text-center text-[12px] text-white/40">
          <Link href="/login" className="focus-ring rounded font-medium text-lime-300 transition hover:text-lime-200">
            Back to sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title="Choose a new password"
        sub={
          email ? (
            <>
              Setting a new password for <span className="font-medium text-white/70">{email}</span>.
            </>
          ) : (
            'Pick something you have not used on this account before.'
          )
        }
      />

      <form onSubmit={submit} className="space-y-4">
        <PasswordField
          value={password}
          onChange={setPassword}
          label="New password"
          autoComplete="new-password"
          showStrength
        />

        <div>
          <PasswordField
            value={confirm}
            onChange={setConfirm}
            label="Confirm new password"
            placeholder="Re-enter your new password"
            autoComplete="new-password"
          />
          {mismatch && <p className="mt-1.5 text-[11px] text-ember-400">Passwords do not match</p>}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <LogOut className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" />
          <p className="text-[11.5px] leading-relaxed text-white/40">
            Saving this will sign you out of every other device.
          </p>
        </div>

        {error && <AuthAlert>{error}</AuthAlert>}

        <Button type="submit" size="lg" variant="lime" className="w-full" loading={busy} disabled={!canSubmit}>
          Update password
          {!busy && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="mt-5 text-center text-[12px] text-white/40">
        Changed your mind?{' '}
        <Link href="/login" className="focus-ring rounded font-medium text-lime-300 transition hover:text-lime-200">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      eyebrow="Set new password"
      badge={{ tone: 'mint', icon: KeyRound, label: 'single-use link' }}
      heading={
        <>
          One new password and you are{' '}
          <span className="font-display italic text-lime-300">back in.</span>
        </>
      }
      subheading="Your new password is hashed with bcrypt before it is stored. Completing this step revokes every session issued before now."
      highlights={[
        { icon: ShieldCheck, text: 'Passwords are hashed with bcrypt — never stored in plain text' },
        { icon: LogOut, text: 'All existing sessions are revoked the moment you save' },
        { icon: Clock, text: 'This link stops working after 30 minutes or one use' }
      ]}
    >
      {/* useSearchParams needs a Suspense boundary during static rendering. */}
      <Suspense
        fallback={
          <div className="space-y-3">
            <div className="h-7 w-2/3 animate-pulse rounded-lg bg-white/[0.06]" />
            <div className="h-4 w-full animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-6 h-12 w-full animate-pulse rounded-xl bg-white/[0.04]" />
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
