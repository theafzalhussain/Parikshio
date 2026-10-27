'use client';

import { cx } from '@/lib/api';

function GoogleGlyph({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.002-.001 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

/**
 * Google sign-in button.
 * Rendered disabled with an explanation when Firebase env vars are absent, so
 * the UI never offers an action that cannot possibly work.
 */
export function GoogleButton({
  onClick,
  loading,
  disabled,
  configured,
  label = 'Continue with Google',
  className
}: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  configured: boolean;
  label?: string;
  className?: string;
}) {
  const unavailable = !configured;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading || unavailable}
        className={cx(
          'focus-ring group relative inline-flex h-12 w-full select-none items-center justify-center gap-3 rounded-xl border border-white/12 bg-white/[0.06] text-sm font-medium text-white/90 transition-all duration-200',
          'hover:border-white/25 hover:bg-white/[0.1] active:translate-y-px',
          'disabled:pointer-events-none disabled:opacity-45'
        )}
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
        ) : (
          <GoogleGlyph />
        )}
        {loading ? 'Opening Google…' : label}
      </button>
      {unavailable && (
        <p className="mt-2 text-center text-[11px] leading-relaxed text-white/30">
          Google sign-in is off — add your Firebase keys to{' '}
          <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px]">.env</code> and restart.
        </p>
      )}
    </div>
  );
}
