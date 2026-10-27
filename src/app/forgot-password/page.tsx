'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Clock, KeyRound, Mail, MailCheck, ShieldCheck, Send } from 'lucide-react';
import { AuthAlert, AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { Button, LinkButton } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ message: string; devLink?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestPasswordReset(email.trim());
      setSent({ message: res.message, devLink: res.devLink });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the reset link right now');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Password recovery"
      badge={{ tone: 'mint', icon: KeyRound, label: 'secure reset' }}
      heading={
        <>
          Locked out? Get back in{' '}
          <span className="font-display italic text-lime-300">safely.</span>
        </>
      }
      subheading="We email a single-use link that expires in 30 minutes. Using it signs out every other device, so a stolen session cannot survive a password change."
      highlights={[
        { icon: Clock, text: 'Reset links expire after 30 minutes and work only once' },
        { icon: ShieldCheck, text: 'Only a hash of the link is stored — never the link itself' },
        { icon: MailCheck, text: 'We never reveal whether an email has an account' }
      ]}
    >
      {sent ? (
        <>
          <AuthHeading title="Check your inbox" sub={sent.message} />

          <div className="rounded-2xl border border-mint-400/20 bg-mint-500/[0.06] p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-mint-400/15 text-mint-300 ring-1 ring-inset ring-mint-400/25">
                <MailCheck className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-white/85">Reset link requested</p>
                <p className="mt-1 break-words text-[12px] leading-relaxed text-white/45">
                  Sent to <span className="font-medium text-white/70">{email.trim()}</span> if that address has an
                  account. The link is valid for 30 minutes.
                </p>
              </div>
            </div>
          </div>

          {/*
            Development convenience: no email transport is configured yet, so the
            server hands back the link directly. This never happens in production.
          */}
          {sent.devLink && (
            <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                development only
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
                Email delivery isn&apos;t wired up yet, so here is the link directly:
              </p>
              <Link
                href={sent.devLink}
                className="focus-ring mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[12.5px] font-medium text-amber-200 transition hover:bg-amber-400/20"
              >
                Open reset link
                <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
              </Link>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setSent(null);
                setError(null);
              }}
              className="focus-ring rounded text-[12px] text-white/40 transition hover:text-white"
            >
              Use a different email
            </button>
            <LinkButton href="/login" variant="secondary" size="sm">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </LinkButton>
          </div>
        </>
      ) : (
        <>
          <AuthHeading
            title="Reset your password"
            sub="Enter the email you signed up with and we'll send a reset link."
          />

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="forgot-email">Email address</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@institute.edu"
                  className="pl-9"
                  required
                  autoFocus
                  autoComplete="email"
                />
              </div>
            </div>

            {error && <AuthAlert>{error}</AuthAlert>}

            <Button type="submit" size="lg" variant="lime" className="w-full" loading={busy}>
              Send reset link
              {!busy && <Send className="h-4 w-4" />}
            </Button>
          </form>

          <p className="mt-5 text-center text-[12px] text-white/40">
            Remembered it?{' '}
            <Link href="/login" className="focus-ring rounded font-medium text-lime-300 transition hover:text-lime-200">
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
