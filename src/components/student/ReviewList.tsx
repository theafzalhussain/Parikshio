import { CheckCircle2, CircleDot, Clock, Lightbulb, MinusCircle, XCircle } from 'lucide-react';
import type { Grade, QuestionType, ReviewItem } from '@shared/types';
import { TypePill } from '@/components/ui/Pills';
import { cx } from '@/lib/api';

/** "B. Mitochondrion" for objective answers, the text itself for written ones. */
export function describeAnswer(type: QuestionType, options: string[], answer: string | null): string {
  if (answer === null || answer === '') return '—';
  if (type === 'mcq' || type === 'truefalse') {
    const idx = Number(answer);
    return Number.isInteger(idx) && options[idx] !== undefined ? `${String.fromCharCode(65 + idx)}. ${options[idx]}` : answer;
  }
  return answer;
}

function Verdict({ grade, awarded, points }: { grade: Grade | null; awarded: number; points: number }) {
  if (grade === null)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/60 ring-1 ring-inset ring-white/10">
        <MinusCircle className="h-3.5 w-3.5" /> not answered
      </span>
    );
  if (grade === 'pending')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/70 ring-1 ring-inset ring-white/10">
        <Clock className="h-3.5 w-3.5" /> in review
      </span>
    );
  const partial = grade === 'correct' && awarded > 0 && awarded < points;
  if (partial)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/[0.13] px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-amber-200 ring-1 ring-inset ring-amber-400/30">
        <CircleDot className="h-3.5 w-3.5" /> partial · {awarded}/{points}
      </span>
    );
  return grade === 'correct' ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-500/[0.14] px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-mint-300 ring-1 ring-inset ring-mint-400/30">
      <CheckCircle2 className="h-3.5 w-3.5" /> +{awarded} pts
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ember-500/[0.13] px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ember-300 ring-1 ring-inset ring-ember-500/30">
      <XCircle className="h-3.5 w-3.5" /> incorrect
    </span>
  );
}

/** Question-by-question review after a session ends (answer key only when the teacher allows it). */
export function ReviewList({ items }: { items: ReviewItem[] }) {
  if (!items.length) {
    return <p className="py-6 text-center text-[13.5px] text-white/55">You did not answer any questions in this session.</p>;
  }
  return (
    <ol className="space-y-3">
      {items.map((item) => {
        const objective = item.type === 'mcq' || item.type === 'truefalse';
        const wrong = item.grade === 'incorrect';
        return (
          <li
            key={item.questionId}
            className={cx(
              'rounded-2xl border p-4 sm:p-5',
              item.grade === 'correct'
                ? 'border-mint-400/20 bg-mint-500/[0.04]'
                : wrong
                  ? 'border-ember-500/20 bg-ember-500/[0.04]'
                  : 'border-white/[0.08] bg-white/[0.02]'
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="num grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] font-display text-[13px] text-white/80">
                  {item.index}
                </span>
                <TypePill type={item.type} />
                <span className="text-[12.5px] text-white/50">{item.points} pts</span>
              </div>
              <Verdict grade={item.grade} awarded={item.awarded} points={item.points} />
            </div>
            <p className="mt-3 font-display text-[17px] leading-relaxed text-white/90">{item.prompt}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.07] bg-ink-950/40 px-3.5 py-2.5">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/45">Your answer</p>
                <p className={cx('mt-1 whitespace-pre-wrap text-[14px]', objective ? 'text-white/85' : 'text-white/75')}>
                  {describeAnswer(item.type, item.options, item.myAnswer)}
                </p>
              </div>
              {item.correctAnswer !== undefined && (
                <div className="rounded-xl border border-mint-400/20 bg-mint-500/[0.05] px-3.5 py-2.5">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-mint-300/80">
                    {objective ? 'Correct answer' : 'Model answer'}
                  </p>
                  <p className="mt-1 text-[14px] text-mint-100">
                    {describeAnswer(item.type, item.options, item.correctAnswer)}
                  </p>
                </div>
              )}
            </div>
            {item.explanation && (
              <p className="mt-3 flex items-start gap-2 text-[13.5px] leading-relaxed text-white/65">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" />
                {item.explanation}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
