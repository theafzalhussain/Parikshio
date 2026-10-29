import { Trophy } from 'lucide-react';
import type { LeaderboardEntry } from '@shared/types';
import { cx, fmtMs } from '@/lib/api';
import { Avatar } from './ui/Pills';
import { EmptyState } from './ui/Panel';

/** Gold, silver and bronze for the podium; everyone else gets a quiet chip. */
const medal = [
  'bg-gradient-to-b from-gold-200 to-gold-500 text-ink-950 ring-gold-200/60 shadow-gold',
  'bg-gradient-to-b from-slate-100 to-slate-400 text-ink-950 ring-white/50',
  'bg-gradient-to-b from-orange-200 to-orange-700 text-ink-950 ring-orange-300/50'
];

export function Leaderboard({
  entries,
  highlightId,
  compact = false,
  max = 8
}: {
  entries: LeaderboardEntry[];
  highlightId?: string;
  compact?: boolean;
  max?: number;
}) {
  if (!entries.length) {
    return (
      <EmptyState
        icon={<Trophy className="h-5 w-5" />}
        title="Leaderboard is warming up"
        body="Rankings appear the moment the first timed answer lands."
      />
    );
  }

  const visible = entries.slice(0, max);

  return (
    <ol className="divide-y divide-white/[0.05]">
      {visible.map((entry) => {
        const isMe = highlightId === entry.studentId;
        return (
          <li
            key={entry.studentId}
            aria-current={isMe ? 'true' : undefined}
            className={cx(
              'flex items-center gap-3 px-2 py-2.5 transition',
              isMe && 'rounded-xl bg-royal-500/[0.1] ring-1 ring-inset ring-royal-400/25'
            )}
          >
            <span
              className={cx(
                'num grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-bold ring-1 ring-inset',
                entry.rank <= 3 ? medal[entry.rank - 1] : 'bg-white/[0.04] text-white/60 ring-white/10'
              )}
            >
              {entry.rank}
            </span>
            <Avatar name={entry.name} size={32} />
            <div className="min-w-0 flex-1">
              <p className={cx('truncate text-[14px] font-medium', isMe ? 'text-white' : 'text-white/85')}>
                {entry.name}
                {isMe && (
                  <span className="ml-2 rounded-full bg-royal-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-royal-100">
                    you
                  </span>
                )}
              </p>
              {!compact && (
                <p className="mt-0.5 text-[12px] text-white/50">
                  {entry.correct}/{entry.answered} correct · avg {fmtMs(entry.avgLatencyMs)}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="num text-[15px] font-semibold text-white">{entry.points}</p>
              <p className="text-[10.5px] uppercase tracking-[0.12em] text-white/45">pts</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
