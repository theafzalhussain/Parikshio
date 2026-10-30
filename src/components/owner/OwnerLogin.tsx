'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { lastOwnerEmail, ownerApi, saveOwnerSession } from '@/lib/owner';
import type { OwnerSignIn } from '@shared/owner';
import { errorText } from './common';

const RESEND_SECONDS = 30;

/** Email + password, or (second step) a 6-digit code emailed to the owner address. */
export function OwnerLogin({ notice, onSignedIn }: { notice: string | null; onSignedIn: (s: OwnerSignIn) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const last = lastOwnerEmail();
    // An address remembered from before the owner email changed is no longer valid.
    setEmail(last.endsWith('@parikshio.tech') ? '' : last);
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await ownerApi<{ message: string; devCode?: string }>('/auth/request-code', {
        method: 'POST',
        body: { email: email.trim() }
      });
      setInfo(res.message);
      setDevCode(res.devCode ?? null);
      setCode('');
      setStep('code');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPassword() {
    setBusy(true);
    setError(null);
    try {
      const session = await ownerApi<OwnerSignIn>('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password }
      });
      saveOwnerSession(session);
      onSignedIn(session);
    } catch (err) {
      setError(errorText(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const session = await ownerApi<OwnerSignIn>('/auth/verify', {
        method: 'POST',
        body: { email: email.trim(), code }
      });
      saveOwnerSession(session);
      onSignedIn(session);
    } catch (err) {
      setError(errorText(err));
      setCode('');
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="relative grid min-h-screen place-items-center px-4 py-10">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 grid-veil opacity-50" />
        <div className="aura aura-royal -left-40 -top-24 h-[30rem] w-[30rem]" />
        <div className="aura aura-gold -bottom-24 right-0 h-[26rem] w-[26rem]" />
      </div>

      <div className="w-full max-w-[420px] animate-fadeUp">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-gold-300/30 bg-ink-900/80 shadow-lift">
            <LogoMark className="h-9 w-9" />
          </span>
          <p className="eyebrow mt-5">Parikshio · private</p>
          <h1 className="mt-2 font-display text-[30px] font-normal leading-tight text-white">Owner console</h1>
          <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-white/55">
            Sign in with your owner email and password.
          </p>
        </div>

        <div className="gold-edge panel relative p-6 sm:p-7">
          {notice && step === 'email' && (
            <p role="status" className="mb-5 rounded-xl border border-amber-400/25 bg-amber-400/[0.08] px-3.5 py-2.5 text-[13px] text-amber-100">
              {notice}
            </p>
          )}

          {step === 'email' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim() && password) void signInWithPassword();
              }}
            >
              <Label htmlFor="owner-email">Owner email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-200/60" />
                <Input
                  id="owner-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner email"
                  className="h-12 pl-10"
                />
              </div>
              <div className="mt-4">
                <Label htmlFor="owner-password">Password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-200/60" />
                  <Input
                    id="owner-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your owner password"
                    className="h-12 pl-10 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="focus-ring absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-white/50 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {error && (
                <p role="alert" className="mt-3 text-[13px] text-ember-300">
                  {error}
                </p>
              )}
              <Button type="submit" variant="gold" size="lg" className="mt-5 w-full" loading={busy} disabled={!email.trim() || !password}>
                <ShieldCheck className="h-4 w-4" /> Sign in
              </Button>
              <button
                type="button"
                onClick={() => void requestCode()}
                disabled={busy || !email.trim()}
                className="focus-ring mt-4 w-full rounded-lg py-1 text-center text-[13px] font-medium text-gold-200 hover:text-gold-100 disabled:cursor-not-allowed disabled:text-white/35"
              >
                Forgot password? Email me a code instead
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 6) void verify();
              }}
            >
              <p className="text-[13.5px] leading-relaxed text-white/65">
                {info} <span className="text-white/45">Check spam too.</span>
              </p>
              <p className="mt-1 break-all text-[13px] font-medium text-gold-200">{email.trim()}</p>
              {devCode && (
                <p className="mt-3 rounded-lg bg-white/[0.05] px-3 py-2 text-[12.5px] text-white/60">
                  Development (no email set up): code <span className="font-mono text-white">{devCode}</span>
                </p>
              )}

              <div className="mt-5">
                <Label htmlFor="owner-code">6-digit code</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-200/60" />
                  <input
                    id="owner-code"
                    ref={codeRef}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    className="input-base h-12 pl-10 font-mono text-[20px] tracking-[0.45em]"
                  />
                </div>
              </div>
              {error && (
                <p role="alert" className="mt-3 text-[13px] text-ember-300">
                  {error}
                </p>
              )}
              <Button type="submit" variant="gold" size="lg" className="mt-5 w-full" loading={busy} disabled={code.length !== 6}>
                <ShieldCheck className="h-4 w-4" /> Open console
              </Button>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setError(null);
                  }}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-white/55 hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Different email
                </button>
                <button
                  type="button"
                  onClick={() => void requestCode()}
                  disabled={cooldown > 0 || busy}
                  className="focus-ring rounded-lg font-medium text-gold-200 hover:text-gold-100 disabled:cursor-not-allowed disabled:text-white/35"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[12px] leading-relaxed text-white/35">
          This page is not linked anywhere on the site. Every sign-in is recorded.
        </p>
      </div>
    </main>
  );
}
