import Link from 'next/link';
import { cx } from '@/lib/api';

export function LogoMark({ className = 'h-9 w-9', accent = '#CBFF3D' }: { className?: string; accent?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="axiom-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9E82FF" />
          <stop offset="55%" stopColor="#7C5CFF" />
          <stop offset="100%" stopColor={accent} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="12" fill="url(#axiom-mark)" opacity="0.16" />
      <rect x="1" y="1" width="38" height="38" rx="12" fill="none" stroke="url(#axiom-mark)" strokeWidth="1.4" opacity="0.7" />
      <path d="M20 8.5 30.5 30h-5.2l-1.9-4.3h-6.8L14.7 30H9.5L20 8.5Z" fill="url(#axiom-mark)" />
      <path d="M20 15.6l2.5 6.1h-5L20 15.6Z" fill="#05060A" />
      <circle cx="31.5" cy="10.5" r="2.4" fill={accent} />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[0.16em] text-white">AXIOM</span>
        {!compact && (
          <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.34em] text-white/35">
            assessment os
          </span>
        )}
      </span>
    </span>
  );
}

export function BrandLink({ href = '/', compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="group inline-flex items-center rounded-xl focus-ring">
      <span className="transition group-hover:opacity-90">
        <Wordmark compact={compact} />
      </span>
    </Link>
  );
}

export function LivePill({ label = 'live', tone = 'lime' }: { label?: string; tone?: 'lime' | 'glass' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
        tone === 'lime'
          ? 'bg-lime-400/15 text-lime-300 ring-1 ring-inset ring-lime-400/30'
          : 'bg-white/[0.06] text-white/60 ring-1 ring-inset ring-white/10'
      )}
    >
      <span className={cx('relative flex h-1.5 w-1.5 rounded-full', tone === 'lime' ? 'bg-lime-400' : 'bg-white/50')}>
        {tone === 'lime' && <span className="absolute inset-0 animate-ping rounded-full bg-lime-400 opacity-75" />}
      </span>
      {label}
    </span>
  );
}
