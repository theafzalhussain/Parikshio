import { Trophy } from 'lucide-react';
import type { LeaderboardEntry } from '@shared/types';
import { cx, fmtMs } from '@/lib/api';
import { Avatar } from './ui/Pills';
import { EmptyState } from './ui/Panel';

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
  const medal = ['bg-lime-400/20 text-lime-300 ring-lime-400/40', 'bg-white/10 text-white/80 ring-white/20', 'bg-ember-500/15 text-ember-400 ring-ember-500/30'];

  return (
    <div className="divide-y divide-white/[0.05]">
      {visible.map((entry) => {
        const isMe = highlightId === entry.studentId;
        return (
          <div
            key={entry.studentId}
            className={cx(
              'flex items-center gap-3 px-1 py-2.5 transition',
              isMe && 'rounded-xl bg-aurora-500/[0.09]'
            )}
          >
            <span
              className={cx(
                'num grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11.5px] font-semibold ring-1 ring-inset',
                entry.rank <= 3 ? medal[entry.rank - 1] : 'bg-white/[0.04] text-white/45 ring-white/10'
              )}
            >
              {entry.rank}
            </span>
            <Avatar name={entry.name} size={30} />
            <div className="min-w-0 flex-1">
              <p className={cx('truncate text-[13px] font-medium', isMe ? 'text-white' : 'text-white/80')}>
                {entry.name}
                {isMe && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-aurora-300">you</span>}
              </p>
              {!compact && (
                <p className="mt-0.5 text-[11px] text-white/35">
                  {entry.correct}/{entry.answered} correct · avg {fmtMs(entry.avgLatencyMs)}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="num text-[13.5px] font-semibold text-white">{entry.points}</p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/30">pts</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
