import Link from 'next/link';
import { cx } from '@/lib/api';
import { SITE_NAME } from '@/lib/site';

/**
 * Gradients and the seal's text ring, rendered once in the root layout.
 * Keeping the ids in a single always-present (zero-size, not display:none)
 * SVG means every mark on the page can reference them, including marks that
 * mount later or sit inside hidden drawers.
 */
export function BrandDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        {/*
          Mapped in the mark's own 48-unit space (userSpaceOnUse), so the stem,
          dial and tick share one light direction. A per-shape bounding box
          would also fail on the stem: a vertical line has zero width.
        */}
        <linearGradient id="brand-gold" x1="10" y1="6" x2="38" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FBEFD2" />
          <stop offset="0.5" stopColor="#E2BE78" />
          <stop offset="1" stopColor="#A9813D" />
        </linearGradient>
        {/* Same palette per shape — for rings, rules and underlines of any size. */}
        <linearGradient id="brand-gold-soft" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#FBEFD2" />
          <stop offset="45%" stopColor="#E4C07C" />
          <stop offset="100%" stopColor="#A9813D" />
        </linearGradient>
        <linearGradient id="brand-tile" x1="24" y1="0" x2="24" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1F2A4A" />
          <stop offset="1" stopColor="#0A0F1D" />
        </linearGradient>
        <path id="brand-seal-ring" d="M60,60 m-50,0 a50,50 0 1,1 100,0 a50,50 0 1,1 -100,0" />
      </defs>
    </svg>
  );
}

/**
 * The Parikshio glyph, in a 48-unit box: a "P" whose bowl is a stopwatch dial
 * with a tick inside — a timed exam, answered correctly. The same geometry is
 * used for the favicon, app icons and the brand kit in /public/brand.
 */
export function MarkGlyph() {
  return (
    <>
      {/* stopwatch crown */}
      <rect x="22.4" y="6.4" width="5.2" height="2.6" rx="1.3" fill="url(#brand-gold)" />
      <rect x="24" y="8" width="2" height="3" fill="url(#brand-gold)" />
      {/* dial = the bowl of the P */}
      <circle cx="25" cy="21" r="8.6" fill="none" stroke="url(#brand-gold)" strokeWidth="4.2" />
      {/* stem */}
      <path d="M14.5 13.6V38" stroke="url(#brand-gold)" strokeWidth="5" strokeLinecap="round" />
      {/* tick */}
      <path
        d="M21.2 21.3l2.7 2.7 4.9-5.3"
        fill="none"
        stroke="url(#brand-gold)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

export function LogoMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect
        x="1.5"
        y="1.5"
        width="45"
        height="45"
        rx="13"
        fill="url(#brand-tile)"
        stroke="url(#brand-gold)"
        strokeOpacity="0.55"
      />
      <MarkGlyph />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <LogoMark className="h-10 w-10 shrink-0 drop-shadow-[0_6px_16px_rgba(223,184,115,0.18)]" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[22px] font-semibold leading-none tracking-[-0.01em] text-white">
          {SITE_NAME}
        </span>
        {!compact && (
          <span className="mt-1.5 hidden text-[9.5px] font-semibold uppercase tracking-[0.34em] text-gold-200/70 sm:block">
            Live assessment
          </span>
        )}
      </span>
    </span>
  );
}

export function BrandLink({ href = '/', compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="group inline-flex items-center rounded-xl focus-ring" aria-label={`${SITE_NAME} — home`}>
      <span className="transition duration-300 group-hover:opacity-90">
        <Wordmark compact={compact} />
      </span>
    </Link>
  );
}

/**
 * Institutional seal: the glyph inside a slowly turning ring of text. Purely
 * decorative; the rotation stops for anyone who prefers reduced motion.
 */
export function Seal({
  className = 'h-40 w-40',
  label = 'PARIKSHIO • INTEGRITY • PRECISION • MERIT • '
}: {
  className?: string;
  label?: string;
}) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <circle cx="60" cy="60" r="58.5" fill="none" stroke="url(#brand-gold-soft)" strokeOpacity="0.55" strokeWidth="0.7" />
      <circle cx="60" cy="60" r="41.5" fill="none" stroke="url(#brand-gold-soft)" strokeOpacity="0.35" strokeWidth="0.6" />
      <g className="animate-spinSlow" style={{ transformOrigin: '60px 60px' }}>
        <text fill="url(#brand-gold-soft)" fontSize="7.2" fontWeight="600" letterSpacing="2.4" fontFamily="var(--font-sans)">
          <textPath href="#brand-seal-ring" textLength="312" lengthAdjust="spacing">
            {label}
          </textPath>
        </text>
      </g>
      <svg x="36" y="35" width="48" height="48" viewBox="0 0 48 48">
        <MarkGlyph />
      </svg>
    </svg>
  );
}

export function LivePill({ label = 'live', tone = 'gold' }: { label?: string; tone?: 'gold' | 'glass' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
        tone === 'gold'
          ? 'bg-gold-400/[0.12] text-gold-200 ring-1 ring-inset ring-gold-300/30'
          : 'bg-white/[0.06] text-white/70 ring-1 ring-inset ring-white/10'
      )}
    >
      <span className={cx('relative flex h-1.5 w-1.5 rounded-full', tone === 'gold' ? 'bg-gold-300' : 'bg-white/50')}>
        {tone === 'gold' && <span className="absolute inset-0 animate-ping rounded-full bg-gold-300 opacity-75" />}
      </span>
      {label}
    </span>
  );
}
