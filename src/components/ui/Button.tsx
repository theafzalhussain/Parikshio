'use client';

import Link from 'next/link';
import { forwardRef } from 'react';
import { cx } from '@/lib/api';

type Variant = 'primary' | 'secondary' | 'ghost' | 'lime' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const base =
  'group relative inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-ring disabled:pointer-events-none disabled:opacity-45';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-aurora-400 to-aurora-600 text-white shadow-[0_10px_30px_-12px_rgba(124,92,255,0.9),inset_0_1px_0_rgba(255,255,255,0.25)] hover:from-aurora-300 hover:to-aurora-500 hover:shadow-[0_16px_40px_-14px_rgba(124,92,255,1)] active:translate-y-px',
  lime:
    'bg-gradient-to-b from-lime-300 to-lime-500 text-ink-950 shadow-[0_10px_30px_-12px_rgba(203,255,61,0.8),inset_0_1px_0_rgba(255,255,255,0.5)] hover:from-lime-300 hover:to-lime-400 active:translate-y-px',
  secondary:
    'border border-white/12 bg-white/[0.05] text-white/90 hover:border-white/25 hover:bg-white/[0.09] active:translate-y-px',
  outline:
    'border border-aurora-400/40 bg-aurora-500/[0.08] text-aurora-100 hover:border-aurora-300/70 hover:bg-aurora-500/[0.16]',
  ghost: 'text-white/65 hover:bg-white/[0.06] hover:text-white',
  danger:
    'border border-ember-500/40 bg-ember-500/10 text-ember-400 hover:border-ember-500/70 hover:bg-ember-500/20'
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12.5px]',
  md: 'h-10 px-4 text-[13.5px]',
  lg: 'h-12 px-6 text-sm'
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
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white focus-ring',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
