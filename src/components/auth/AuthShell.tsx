'use client';

import Link from 'next/link';
import { ArrowLeft, Lock } from 'lucide-react';
import { BrandLink, Seal } from '@/components/Logo';
import { Badge } from '@/components/ui/Panel';
import { cx } from '@/lib/api';

export interface AuthHighlight {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}

/**
 * Shared frame for every auth screen (sign in, sign up, forgot, reset).
 * Keeps the brand panel, background wash and responsive behaviour in one place
 * so the four pages only describe their own form.
 */
export function AuthShell({
  eyebrow,
  heading,
  subheading,
  highlights,
  badge,
  panelKey,
  children,
  footer
}: {
  eyebrow: string;
  heading: React.ReactNode;
  subheading: string;
  highlights: AuthHighlight[];
  badge?: { tone: 'gold' | 'royal' | 'mint'; icon: React.ComponentType<{ className?: string }>; label: string };
  /** Changing it replays the brand panel's entrance, e.g. when the role tab switches. */
  panelKey?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative grid min-h-screen lg:grid-cols-[1.08fr_1fr]">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 grid-veil opacity-60" />
        <div className="aura aura-royal -left-40 -top-24 h-[34rem] w-[34rem]" />
        <div className="aura aura-gold -bottom-32 right-[10%] h-[30rem] w-[30rem]" />
      </div>

      {/* brand side */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.07] bg-gradient-to-b from-ink-900/70 via-ink-950/30 to-ink-950/70 p-10 lg:flex xl:p-14">
        <BrandLink href="/" />

        <div key={panelKey} className="relative z-10 max-w-[30rem] animate-fadeUp">
          {badge && (
            <Badge tone={badge.tone}>
              <badge.icon className="h-3 w-3" /> {badge.label}
            </Badge>
          )}
          <h1 className="mt-6 font-display text-[2.7rem] font-normal leading-[1.06] text-white xl:text-[3.1rem]">
            {heading}
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-white/60">{subheading}</p>

          <ul className="mt-9 space-y-4">
            {highlights.map((row) => (
              <li key={row.text} className="flex items-start gap-3.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gold-400/[0.09] text-gold-200 ring-1 ring-inset ring-gold-300/25">
                  <row.icon className="h-4 w-4" />
                </span>
                <p className="pt-1 text-[14px] leading-relaxed text-white/70">{row.text}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 flex items-center gap-4 text-[12px] text-white/45">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-gold-300/70" /> Encrypted sessions · role-based access
          </span>
          <span className="h-3 w-px bg-white/15" />
          <span>v1.0</span>
        </div>

        {/* Institutional seal, cropped by the panel edge. */}
        <Seal className="pointer-events-none absolute -bottom-20 -right-20 h-[22rem] w-[22rem] opacity-50" />
      </aside>

      {/* form side */}
      <main id="main" className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:py-14">
        <div className="mx-auto w-full max-w-[460px]">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <BrandLink href="/" />
            <Link
              href="/"
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-[13px] text-white/55 transition hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Home
            </Link>
          </div>

          <div className="animate-popIn sm:gold-edge sm:rounded-[28px] sm:border sm:border-white/[0.07] sm:bg-ink-900/70 sm:p-9 sm:shadow-lift">
            <p className="eyebrow eyebrow-rule mb-7">{eyebrow}</p>
            {children}
          </div>

          {footer && <div className="mt-7">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

/** Page-level heading used inside the form column. */
export function AuthHeading({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <div className="mb-7 -mt-2">
      <h2 className="font-display text-[30px] font-medium leading-tight text-white">{title}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-white/60">{sub}</p>
    </div>
  );
}

/** Inline form error / notice banner. */
export function AuthAlert({
  tone = 'error',
  children
}: {
  tone?: 'error' | 'success' | 'info' | 'warn';
  children: React.ReactNode;
}) {
  const tones = {
    error: 'border-ember-500/35 bg-ember-500/10 text-ember-300',
    success: 'border-mint-400/30 bg-mint-500/10 text-mint-300',
    info: 'border-royal-400/30 bg-royal-500/10 text-royal-100',
    warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  } as const;

  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed', tones[tone])}
    >
      {children}
    </p>
  );
}

/** "or" rule between the Google button and the email form. */
export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">{label}</span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
    </div>
  );
}
