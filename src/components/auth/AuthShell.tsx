'use client';

import Link from 'next/link';
import { BrandLink } from '@/components/Logo';
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
  children,
  footer
}: {
  eyebrow: string;
  heading: React.ReactNode;
  subheading: string;
  highlights: AuthHighlight[];
  badge?: { tone: 'lime' | 'violet' | 'mint'; icon: React.ComponentType<{ className?: string }>; label: string };
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 grid-veil opacity-60" />
        <div className="aura aura-violet -left-32 top-0 h-96 w-96" />
        <div className="aura aura-mint bottom-0 right-0 h-96 w-96" />
      </div>

      {/* brand side */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.07] p-10 lg:flex xl:p-14">
        <BrandLink href="/" />

        <div className="max-w-md">
          {badge && (
            <Badge tone={badge.tone}>
              <badge.icon className="h-3 w-3" /> {badge.label}
            </Badge>
          )}
          <h1 className="mt-5 text-[2.3rem] font-semibold leading-[1.08] tracking-[-0.025em] text-white xl:text-[2.6rem]">
            {heading}
          </h1>
          <p className="mt-4 text-[13.5px] leading-relaxed text-white/45">{subheading}</p>

          <div className="mt-8 space-y-3">
            {highlights.map((row) => (
              <div key={row.text} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-lime-300 ring-1 ring-inset ring-white/10">
                  <row.icon className="h-3.5 w-3.5" />
                </span>
                <p className="text-[12.5px] leading-relaxed text-white/55">{row.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-white/25">
          <span>Socket.io · Redis · MongoDB</span>
          <span className="h-3 w-px bg-white/10" />
          <span>v1.0</span>
        </div>
      </aside>

      {/* form side */}
      <main id="main" className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <BrandLink href="/" />
            <Link href="/" className="text-[12px] text-white/40 transition hover:text-white">
              ← back
            </Link>
          </div>

          <div className="mb-6">
            <p className="eyebrow mb-2">{eyebrow}</p>
          </div>

          {children}

          {footer && <div className="mt-8">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

/** Page-level heading used inside the form column. */
export function AuthHeading({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <div className="mb-6 -mt-4">
      <h2 className="text-[1.6rem] font-semibold tracking-[-0.02em] text-white">{title}</h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/40">{sub}</p>
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
    error: 'border-ember-500/30 bg-ember-500/10 text-ember-400',
    success: 'border-mint-400/30 bg-mint-500/10 text-mint-300',
    info: 'border-aurora-400/30 bg-aurora-500/10 text-aurora-100',
    warn: 'border-amber-400/30 bg-amber-400/10 text-amber-300'
  } as const;

  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-xl border px-3 py-2 text-[12px] leading-relaxed', tones[tone])}
    >
      {children}
    </p>
  );
}

/** "or" rule between the Google button and the email form. */
export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/12" />
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/30">{label}</span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/12" />
    </div>
  );
}
