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

const typeMeta: Record<QuestionType, { label: string; short: string; tone: 'royal' | 'gold' | 'mint' | 'ember' | 'sky'; icon: typeof Circle }> = {
  mcq: { label: 'Multiple choice', short: 'MCQ', tone: 'royal', icon: ListChecks },
  truefalse: { label: 'True / False', short: 'T/F', tone: 'sky', icon: Equal },
  fill: { label: 'Fill in the blank', short: 'FILL', tone: 'gold', icon: Type },
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
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gold-400/[0.12] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-200 ring-1 ring-inset ring-gold-300/35">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-300 opacity-80" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold-300" />
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
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-[13.5px] text-white/60">
      <span className="relative grid h-5 w-5 place-items-center">
        <span className="absolute inset-0 rounded-full border border-gold-300/20" />
        <Loader2 className="h-5 w-5 animate-spin text-gold-300" />
      </span>
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
        'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-royal-500/50 via-ink-700 to-gold-500/35 font-semibold tracking-[0.02em] text-white ring-1 ring-inset ring-gold-200/20'
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        ...(tone ? { background: tone } : {})
      }}
    >
      {label}
    </span>
  );
}

export function ThumbsUpStat({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] text-white/55">
      <ThumbsUp className="h-3 w-3" />
      {count}
    </span>
  );
}
