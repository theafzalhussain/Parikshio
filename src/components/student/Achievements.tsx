'use client';

import { useState } from 'react';
import {
  CalendarCheck,
  Crosshair,
  Flame,
  Footprints,
  Gem,
  Lock,
  Medal,
  Shapes,
  Trophy,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { Badge, SectionHead } from '@/components/ui/Panel';
import { cx } from '@/lib/api';
import type { BadgeId, BadgeState } from '@/lib/progress';

const ICONS: Record<BadgeId, LucideIcon> = {
  first: Footprints,
  streak: Flame,
  sharp: Crosshair,
  quick: Zap,
  regular: CalendarCheck,
  podium: Medal,
  century: Gem,
  allrounder: Shapes
};

/** One badge: a medallion on the front, how to earn it on the back. Tap, click or Enter flips it. */
function BadgeCard({ badge, index }: { badge: BadgeState; index: number }) {
  const [flipped, setFlipped] = useState(false);
  const Icon = ICONS[badge.id];
  const percent = Math.round(badge.progress * 100);

  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      aria-pressed={flipped}
      aria-label={`${badge.name}. ${badge.earned ? 'Earned.' : `Not earned yet: ${badge.status}.`} ${badge.goal}`}
      className={cx('flip-card focus-ring animate-fadeUp rounded-2xl text-left', flipped && 'is-flipped')}
      style={{ animationDelay: `${120 + index * 70}ms` }}
    >
      <span className="flip-inner" aria-hidden="true">
        {/* front */}
        <span
          className={cx(
            'flip-face flex flex-col items-center justify-center gap-3 border px-3 text-center',
            badge.earned
              ? 'border-gold-300/30 bg-gradient-to-b from-gold-400/[0.12] via-ink-900/80 to-ink-900/90'
              : 'border-white/[0.07] bg-ink-900/70'
          )}
        >
          <span
            className={cx(
              'medal relative grid h-14 w-14 place-items-center rounded-full',
              badge.earned
                ? 'bg-gradient-to-b from-gold-200 via-gold-400 to-gold-600 text-ink-950 shadow-[0_10px_30px_-10px_rgba(223,184,115,0.9)]'
                : 'bg-white/[0.06] text-white/35 ring-1 ring-inset ring-white/10'
            )}
          >
            <Icon className="h-6 w-6" strokeWidth={2} />
            {!badge.earned && (
              <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-ink-800 text-white/55 ring-1 ring-white/15">
                <Lock className="h-2.5 w-2.5" />
              </span>
            )}
          </span>
          <span>
            <span className={cx('block text-[13.5px] font-semibold', badge.earned ? 'text-white' : 'text-white/70')}>
              {badge.name}
            </span>
            <span className={cx('mt-0.5 block text-[11.5px]', badge.earned ? 'text-gold-200' : 'text-white/45')}>
              {badge.earned ? 'Earned' : badge.status}
            </span>
          </span>
        </span>

        {/* back */}
        <span className="flip-face flip-back flex flex-col justify-between border border-royal-400/25 bg-gradient-to-b from-royal-500/[0.16] to-ink-900/95 p-4">
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-royal-100/80">How to earn</span>
            <span className="mt-1.5 block text-[12.5px] leading-snug text-white/85">{badge.goal}</span>
          </span>
          <span>
            <span className="flex items-center justify-between text-[11px] text-white/55">
              <span>{badge.status}</span>
              <span className="num">{percent}%</span>
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-royal-400 to-gold-300"
                style={{ width: `${Math.max(percent, 4)}%` }}
              />
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}

export function Achievements({ badges }: { badges: BadgeState[] }) {
  const earned = badges.filter((b) => b.earned).length;
  return (
    <section aria-labelledby="badges-heading">
      <SectionHead
        eyebrow="Badges"
        title={<span id="badges-heading">Your achievements</span>}
        sub="Earn badges by answering, keeping streaks and climbing the leaderboard. Tap a badge to see how to earn it."
        action={
          <Badge tone="gold">
            <Trophy className="h-3 w-3" /> {earned} of {badges.length} earned
          </Badge>
        }
      />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {badges.map((badge, i) => (
          <BadgeCard key={badge.id} badge={badge} index={i} />
        ))}
      </div>
    </section>
  );
}
