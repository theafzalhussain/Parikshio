'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';

const CODE_RE = /^[A-Z0-9]{4,10}$/;

/**
 * The hero's one action: most visitors are students whose teacher said "go to
 * Parikshio and enter this code". A signed-in student goes straight to the
 * lobby, which joins the room; anyone else signs in first and lands there.
 */
export function HeroJoin() {
  const router = useRouter();
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = code.trim().toUpperCase();
    if (!CODE_RE.test(value)) {
      setError('Enter the exam code your teacher shared — letters and numbers only.');
      return;
    }
    setError(null);
    setBusy(true);
    const lobby = `/student?join=${encodeURIComponent(value)}`;
    if (user?.role === 'student') router.push(lobby);
    else if (user?.role === 'admin') router.push('/admin/exams');
    else router.push(`/login?role=student&next=${encodeURIComponent(lobby)}`);
  }

  return (
    <div className="mt-9 max-w-xl">
      <form
        onSubmit={submit}
        noValidate
        className="gold-edge flex flex-wrap gap-2 rounded-2xl border border-white/[0.08] bg-ink-900/80 p-2 shadow-lift"
      >
        <label htmlFor="hero-exam-code" className="sr-only">
          Exam code
        </label>
        <div className="relative min-w-[11rem] flex-1">
          <KeyRound
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-200/60"
          />
          <input
            id="hero-exam-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
              if (error) setError(null);
            }}
            placeholder="Exam code"
            maxLength={10}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? 'hero-exam-code-error' : undefined}
            className="h-12 w-full rounded-xl bg-transparent pl-11 pr-3 font-mono text-[17px] uppercase tracking-[0.22em] text-white outline-none placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-gold-300/60"
          />
        </div>
        <Button type="submit" variant="gold" size="lg" loading={busy} className="px-6">
          Join exam
          {!busy && <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />}
        </Button>
      </form>
      {error && (
        <p id="hero-exam-code-error" role="alert" className="mt-2.5 text-[13px] text-ember-300">
          {error}
        </p>
      )}
      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[13.5px] text-white/55">
        <span>
          Teaching?{' '}
          <Link
            href="/login?role=faculty"
            className="focus-ring rounded font-medium text-gold-200 underline-offset-4 transition hover:text-gold-100 hover:underline"
          >
            Faculty log in
          </Link>
        </span>
        <span>
          New student?{' '}
          <Link
            href="/signup"
            className="focus-ring rounded font-medium text-gold-200 underline-offset-4 transition hover:text-gold-100 hover:underline"
          >
            Create an account
          </Link>
        </span>
      </p>
    </div>
  );
}
