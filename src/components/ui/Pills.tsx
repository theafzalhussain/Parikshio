import {
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Equal,
  ListChecks,
  Loader2,
  PenLine,
  ThumbsUp,
  Type,
  XCircle
} from 'lucide-react';
import type { Grade, QuestionType } from '@shared/types';
import { cx } from '@/lib/api';
import { Badge } from './Panel';

const typeMeta: Record<QuestionType, { label: string; short: string; tone: 'violet' | 'lime' | 'mint' | 'ember' | 'sky'; icon: typeof Circle }> = {
  mcq: { label: 'Multiple choice', short: 'MCQ', tone: 'violet', icon: ListChecks },
  truefalse: { label: 'True / False', short: 'T/F', tone: 'sky', icon: Equal },
  fill: { label: 'Fill in the blank', short: 'FILL', tone: 'lime', icon: Type },
  short: { label: 'Short answer', short: 'SHORT', tone: 'mint', icon: PenLine },
  long: { label: 'Long answer', short: 'LONG', tone: 'ember', icon: PenLine }
};

export function TypePill({ type, withIcon = true }: { type: QuestionType; withIcon?: boolean }) {
  const meta = typeMeta[type];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      {withIcon && <Icon className="h-3 w-3" />}
      {meta.short}
    </Badge>
  );
}

export function typeLabel(type: QuestionType): string {
  return typeMeta[type].label;
}

export function GradePill({ grade, awarded, points }: { grade: Grade; awarded?: number; points?: number }) {
  const partial = grade === 'correct' && awarded !== undefined && !!points && awarded > 0 && awarded < points;
  if (partial)
    return (
      <Badge tone="amber">
        <CircleDot className="h-3 w-3" />
        partial · {awarded}/{points}
      </Badge>
    );
  if (grade === 'correct')
    return (
      <Badge tone="mint">
        <CheckCircle2 className="h-3 w-3" />
        correct{awarded !== undefined ? ` · ${awarded}${points ? `/${points}` : ''}` : ''}
      </Badge>
    );
  if (grade === 'incorrect')
    return (
      <Badge tone="ember">
        <XCircle className="h-3 w-3" />
        incorrect
      </Badge>
    );
  return (
    <Badge tone="neutral">
      <Clock className="h-3 w-3" />
      review
    </Badge>
  );
}

export function StatusPill({ status }: { status: 'draft' | 'live' | 'ended' }) {
  if (status === 'live')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-lime-400/12 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-lime-300 ring-1 ring-inset ring-lime-400/30">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-80" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime-400" />
        </span>
        live
      </span>
    );
  if (status === 'ended')
    return (
      <Badge tone="neutral">
        <CircleDot className="h-3 w-3" />
        ended
      </Badge>
    );
  return (
    <Badge tone="neutral">
      <Circle className="h-3 w-3" />
      draft
    </Badge>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-[12.5px] text-white/40">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}…
    </div>
  );
}

export function Avatar({ name, size = 32, tone }: { name: string; size?: number; tone?: string }) {
  const label = name
    .replace(/^Dr\.\s*|^Faculty\s*·\s*/, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span
      className={cx(
        'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-aurora-500/40 to-mint-500/25 text-[11px] font-semibold text-white ring-1 ring-inset ring-white/15'
      )}
      style={{ width: size, height: size, ...(tone ? { background: tone } : {}) }}
    >
      {label}
    </span>
  );
}

export function ThumbsUpStat({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-white/40">
      <ThumbsUp className="h-3 w-3" />
      {count}
    </span>
  );
}
