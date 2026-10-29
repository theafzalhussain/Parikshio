import { Timer } from 'lucide-react';
import { cx } from '@/lib/api';
import { fmtClock } from '@/lib/time';

/**
 * Phones only: a slim countdown that stays pinned under the header while the
 * student scrolls a long question, so the time left is never out of sight.
 * (Large screens show the full dial in the side column instead.)
 */
export function MobileTimerBar({
  remaining,
  total,
  urgent,
  label
}: {
  remaining: number;
  total: number;
  urgent: boolean;
  label: string;
}) {
  const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  return (
    <div className="sticky top-[4.4rem] z-30 lg:hidden" role="timer" aria-label={`${label}: ${fmtClock(remaining)} left`}>
      <div
        className={cx(
          'overflow-hidden rounded-2xl border bg-ink-900/90 shadow-lift backdrop-blur-xl',
          urgent ? 'border-ember-500/40' : 'border-white/10'
        )}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="truncate text-[13px] font-medium text-white/75">{label}</span>
          <span className={cx('num flex items-center gap-1.5 text-[17px] font-semibold', urgent ? 'text-ember-300' : 'text-white')}>
            <Timer className="h-4 w-4 opacity-70" />
            {fmtClock(remaining)}
          </span>
        </div>
        <div className="h-1 bg-white/[0.06]">
          <div
            className={cx(
              'h-full transition-[width] duration-300 ease-linear',
              urgent ? 'bg-ember-500' : fraction > 0.4 ? 'bg-mint-400' : 'bg-amber-400'
            )}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
