'use client';

import Link from 'next/link';
import { forwardRef } from 'react';
import { cx } from '@/lib/api';

/**
 * gold      the one primary action on a screen (sign in, submit, push)
 * primary   royal-indigo emphasis for a second strong action
 * secondary quiet glass button for everything else
 * outline   indigo outline — an alternative that should still stand out
 * ghost     text-only, for tertiary actions in dense rows
 * danger    destructive (end session, delete)
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const base =
  'group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium tracking-[-0.005em] transition-all duration-200 ease-out focus-ring disabled:pointer-events-none disabled:opacity-45';

const variants: Record<Variant, string> = {
  gold:
    'bg-gradient-to-b from-gold-200 via-gold-300 to-gold-500 text-ink-950 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(0,0,0,0.12),0_12px_30px_-14px_rgba(223,184,115,0.75)] hover:-translate-y-px hover:brightness-[1.05] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_0_-1px_0_rgba(0,0,0,0.12),0_18px_38px_-14px_rgba(223,184,115,0.85)] active:translate-y-0 active:brightness-95',
  primary:
    'bg-gradient-to-b from-royal-400 to-royal-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_12px_30px_-14px_rgba(98,121,245,0.9)] hover:-translate-y-px hover:from-royal-300 hover:to-royal-500 active:translate-y-0',
  secondary:
    'border border-white/[0.12] bg-white/[0.05] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-white/25 hover:bg-white/[0.09] hover:text-white active:translate-y-px',
  outline:
    'border border-royal-400/40 bg-royal-500/[0.08] text-royal-100 hover:border-royal-300/70 hover:bg-royal-500/[0.16] active:translate-y-px',
  ghost: 'text-white/70 hover:bg-white/[0.06] hover:text-white',
  danger:
    'border border-ember-500/40 bg-ember-500/10 text-ember-300 hover:border-ember-500/70 hover:bg-ember-500/20 active:translate-y-px'
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px]',
  md: 'h-11 px-5 text-[14px]',
  lg: 'h-12 px-6 text-[15px]'
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  loading?: boolean;
}

export const Button = forwardRef<
  HTMLButtonElement,
  CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Button({ variant = 'primary', size = 'md', className, loading, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cx(base, variants[variant], sizes[size], className)}
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children
}: CommonProps & { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cx(base, variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}

export function IconButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/65 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white focus-ring',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
