'use client';

import { useEffect, useId, useState } from 'react';
import { Flame, Target, Trophy } from 'lucide-react';
import type { LevelInfo } from '@/lib/progress';
import { KnowledgeCube, Tilt3D } from './Motion3D';

/** The progress ring fills from empty on first paint, then follows the points. */
function LevelRing({ level, progress }: { level: number; progress: number }) {
  const gradientId = useId().replace(/:/g, '');
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setDrawn(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <div className="depth-sm relative grid h-[6.25rem] w-[6.25rem] shrink-0 place-items-center sm:h-32 sm:w-32">
      <svg viewBox="0 0 112 112" className="absolute inset-0 h-full w-full -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FBEFD2" />
            <stop offset="55%" stopColor="#E2BE78" />
            <stop offset="100%" stopColor="#A9813D" />
          </linearGradient>
        </defs>
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx="56"
          cy="56"
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - (drawn ? Math.max(progress, 0.02) : 0))}
          className="transition-[stroke-dashoffset] duration-[1600ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        />
      </svg>
      <span className="pointer-events-none absolute inset-3 rounded-full bg-gradient-to-b from-white/[0.06] to-transparent" />
      <div className="relative text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55">Level</p>
        <p className="font-display text-[2.4rem] font-medium leading-none text-white">{level}</p>
      </div>
    </div>
  );
}

/**
 * The hero card: level and progress to the next one, three quick numbers, and
 * the knowledge cube rising out of its corner. The whole card tilts with the
 * pointer; the ring, chips and cube sit at different depths for parallax.
 */
export function LevelCard({
  info,
  answered,
  accuracy,
  bestStreak,
  badgesEarned,
  badgesTotal
}: {
  info: LevelInfo;
  /** Answers given so far, graded or not. */
  answered: number;
  accuracy: number;
  bestStreak: number;
  badgesEarned: number;
  badgesTotal: number;
}) {
  const started = answered > 0;
  return (
    <Tilt3D className="rounded-[28px]" max={9}>
      <div className="preserve-3d relative rounded-[28px] border border-white/[0.1] bg-gradient-to-br from-ink-700/80 via-ink-850/95 to-ink-950 p-4 shadow-lift min-[360px]:p-5 sm:p-6">
        {/* Inner light and a champagne hairline, painted inside the card. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[28px] bg-[radial-gradient(120%_80%_at_0%_0%,rgba(98,121,245,0.22),transparent_55%),radial-gradient(90%_70%_at_100%_100%,rgba(223,184,115,0.16),transparent_60%)]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold-200/50 to-transparent"
        />

        {/* Phones: the label sits in a band of its own, clear of the cube. */}
        <p className="eyebrow relative mb-4 sm:hidden">Your level</p>

        <div className="preserve-3d relative flex flex-col items-start gap-4 min-[380px]:flex-row min-[380px]:items-center sm:gap-5">
          <LevelRing level={info.level} progress={info.progress} />
          <div className="depth-sm min-w-0 sm:pr-10">
            <p className="eyebrow hidden sm:block">Your level</p>
            <p className="font-display text-[1.45rem] font-medium leading-tight text-white sm:mt-1.5 sm:text-[1.85rem]">
              <span className="gold-text">{info.name}</span>
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
              {info.next
                ? started
                  ? `${info.toNext} points to Level\u00a0${info.next.level}\u00a0·\u00a0${info.next.name}`
                  : 'Answer your first question to start levelling up.'
                : 'Top level reached. Keep your streak going!'}
            </p>
          </div>
        </div>

        <div className="depth-md relative mt-5 grid grid-cols-3 gap-1.5 min-[360px]:gap-2">
          {[
            { icon: Target, label: 'Accuracy', value: started ? `${accuracy}%` : '—' },
            { icon: Flame, label: 'Streak', value: String(bestStreak) },
            { icon: Trophy, label: 'Badges', value: `${badgesEarned}/${badgesTotal}` }
          ].map((chip, i) => (
            <div
              key={chip.label}
              className="chip-float min-w-0 rounded-2xl border border-white/[0.09] bg-ink-950/60 px-2 py-2.5 shadow-[0_14px_30px_-18px_rgba(0,0,0,0.9)] min-[390px]:px-2.5 sm:px-3"
              style={{ animationDelay: `${i * 0.6}s` }}
            >
              <chip.icon className="h-3.5 w-3.5 text-gold-300" />
              <p className="num mt-1.5 text-[16px] font-semibold leading-none text-white">{chip.value}</p>
              {/* Small phones keep the label in normal case so "Accuracy" fits without an ellipsis. */}
              <p className="mt-1 truncate text-[10px] text-white/45 min-[390px]:uppercase min-[390px]:tracking-[0.08em] sm:text-[10.5px] sm:tracking-[0.12em]">
                {chip.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Rises out of the top-right corner of the card. */}
      <KnowledgeCube className="depth-lg pointer-events-none absolute -top-12 right-2 sm:-right-3 sm:-top-9" />
    </Tilt3D>
  );
}
