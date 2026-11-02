'use client';

import { useState } from 'react';
import { BookOpenCheck, ChevronDown, CircleDot, Lightbulb, Loader2, MinusCircle, Sparkles, ThumbsUp, TrendingUp, XCircle } from 'lucide-react';
import type { AnswerReveal } from '@shared/types';
import { Panel } from '@/components/ui/Panel';
import { cx } from '@/lib/api';
import { describeAnswer } from './ReviewList';
import type { StudentLang } from './QuestionLanguage';

/** "Correct answer · सही उत्तर" when the student reads Hindi. */
function Label({ en, hi, showHindi, className }: { en: string; hi: string; showHindi: boolean; className?: string }) {
  return (
    <p className={cx('text-[11px] font-semibold uppercase tracking-[0.12em]', className)}>
      {en}
      {showHindi && (
        <span lang="hi" className="hindi-text ml-1.5 normal-case tracking-normal">
          · {hi}
        </span>
      )}
    </p>
  );
}

/** Hindi first (what the student reads), the English original underneath. */
function Bilingual({ en, hi, showHindi, className }: { en: string; hi?: string; showHindi: boolean; className?: string }) {
  if (!showHindi || !hi) return <p className={cx('whitespace-pre-wrap', className)}>{en}</p>;
  return (
    <div>
      <p lang="hi" className={cx('hindi-text whitespace-pre-wrap', className)}>
        {hi}
      </p>
      <p lang="en" className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/50">
        <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">English</span>
        {en}
      </p>
    </div>
  );
}

function headline(reveal: AnswerReveal): { en: string; hi: string } {
  if (reveal.outcome === 'unanswered')
    return { en: 'You did not answer before the question closed', hi: 'प्रश्न बंद होने से पहले आपने उत्तर नहीं दिया' };
  if (reveal.outcome === 'partial')
    return {
      en: `You got ${reveal.awarded} of ${reveal.points} marks`,
      hi: `आपको ${reveal.points} में से ${reveal.awarded} अंक मिले`
    };
  return { en: 'Your answer was not correct', hi: 'आपका उत्तर सही नहीं था' };
}

function OutcomeBadge({ reveal }: { reveal: AnswerReveal }) {
  if (reveal.outcome === 'partial')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/[0.13] px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-amber-200 ring-1 ring-inset ring-amber-400/30">
        <CircleDot className="h-3.5 w-3.5" /> partial · {reveal.awarded}/{reveal.points}
      </span>
    );
  if (reveal.outcome === 'unanswered')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/65 ring-1 ring-inset ring-white/10">
        <MinusCircle className="h-3.5 w-3.5" /> not answered · 0/{reveal.points}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ember-500/[0.13] px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ember-300 ring-1 ring-inset ring-ember-500/30">
      <XCircle className="h-3.5 w-3.5" /> incorrect · 0/{reveal.points}
    </span>
  );
}

function RevealBody({ reveal, showHindi }: { reveal: AnswerReveal; showHindi: boolean }) {
  const objective = reveal.type === 'mcq' || reveal.type === 'truefalse';
  const hindi = reveal.hindi ?? {};
  const correctIdx = reveal.correctOptionIndex;
  const answerLabel =
    reveal.answerSource === 'ai'
      ? { en: 'Model answer · written by AI', hi: 'आदर्श उत्तर · AI द्वारा' }
      : objective || reveal.type === 'fill'
        ? { en: 'Correct answer', hi: 'सही उत्तर' }
        : { en: 'Model answer', hi: 'आदर्श उत्तर' };

  return (
    <div className="space-y-3">
      <div className={cx('grid gap-2.5', reveal.myAnswer !== null && 'sm:grid-cols-2')}>
        {reveal.myAnswer !== null && (
          <div className="rounded-xl border border-white/[0.08] bg-ink-950/40 px-3.5 py-3">
            <Label en="Your answer" hi="आपका उत्तर" showHindi={showHindi} className="text-white/45" />
            <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap text-[14px] leading-relaxed text-white/75">
              {describeAnswer(reveal.type, reveal.options, reveal.myAnswer)}
            </p>
          </div>
        )}

        <div className="rounded-xl border border-mint-400/25 bg-mint-500/[0.06] px-3.5 py-3">
          <Label en={answerLabel.en} hi={answerLabel.hi} showHindi={showHindi} className="text-mint-300/85" />
          <div className="mt-1.5 text-[14px] leading-relaxed text-mint-50">
            {objective && correctIdx !== undefined ? (
              <Bilingual
                en={describeAnswer(reveal.type, reveal.options, String(correctIdx))}
                hi={hindi.options?.[correctIdx] ? `${String.fromCharCode(65 + correctIdx)}. ${hindi.options[correctIdx]}` : undefined}
                showHindi={showHindi}
                className="font-medium"
              />
            ) : reveal.answers.length > 0 ? (
              <ul className="space-y-2">
                {reveal.answers.map((answer, i) => (
                  <li key={i} className={cx(reveal.answers.length > 1 && 'flex gap-2')}>
                    {reveal.answers.length > 1 && <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-mint-300/70" />}
                    <Bilingual en={answer} hi={hindi.answers?.[i] || undefined} showHindi={showHindi} />
                  </li>
                ))}
              </ul>
            ) : reveal.preparing ? (
              <p className="flex items-center gap-2 text-white/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> The AI is writing the model answer…
              </p>
            ) : (
              <p className="text-white/60">Your teacher has not added an answer for this question.</p>
            )}
          </div>
        </div>
      </div>

      {reveal.explanation && (
        <div className="flex items-start gap-2.5 rounded-xl border border-gold-300/15 bg-gold-400/[0.04] px-3.5 py-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" />
          <div className="min-w-0 flex-1">
            <Label en="Explanation" hi="व्याख्या" showHindi={showHindi} className="text-gold-200/80" />
            <Bilingual en={reveal.explanation} hi={hindi.explanation} showHindi={showHindi} className="mt-1 text-[13.5px] leading-relaxed text-white/75" />
          </div>
        </div>
      )}

      {reveal.feedback && (
        <div className="rounded-xl border border-royal-400/25 bg-royal-500/[0.07] px-3.5 py-3">
          <Label en="AI evaluation of your answer" hi="आपके उत्तर का AI मूल्यांकन" showHindi={showHindi} className="flex items-center gap-1.5 text-royal-100/85" />
          <Bilingual en={reveal.feedback.text} hi={hindi.feedback} showHindi={showHindi} className="mt-1.5 text-[13.5px] leading-relaxed text-white/80" />
          {reveal.feedback.strengths.length > 0 && (
            <div className="mt-3">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-mint-300/90">
                <ThumbsUp className="h-3.5 w-3.5" /> What you did well{showHindi && <span lang="hi" className="hindi-text"> · आपने क्या अच्छा किया</span>}
              </p>
              <ul className="mt-1 space-y-1">
                {reveal.feedback.strengths.map((s, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-white/70">
                    <Bilingual en={`• ${s}`} hi={hindi.strengths?.[i] ? `• ${hindi.strengths[i]}` : undefined} showHindi={showHindi} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {reveal.feedback.improvements.length > 0 && (
            <div className="mt-3">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-amber-200/90">
                <TrendingUp className="h-3.5 w-3.5" /> How to get full marks{showHindi && <span lang="hi" className="hindi-text"> · पूरे अंक कैसे पाएँ</span>}
              </p>
              <ul className="mt-1 space-y-1">
                {reveal.feedback.improvements.map((s, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-white/70">
                    <Bilingual en={`• ${s}`} hi={hindi.improvements?.[i] ? `• ${hindi.improvements[i]}` : undefined} showHindi={showHindi} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {reveal.preparing && (reveal.answers.length > 0 || objective) && (
        <p className="flex items-center gap-2 text-[12px] text-white/50">
          <Loader2 className="h-3 w-3 animate-spin" />
          {showHindi ? 'Preparing the Hindi version…' : 'Preparing…'}
        </p>
      )}
    </div>
  );
}

/**
 * The answer to a closed live question, for a student who lost marks on it.
 * `collapsible` is the previous question, shown folded under the next one so
 * it never gets in the way of a running timer.
 */
export function AnswerRevealCard({
  reveal,
  lang,
  collapsible = false
}: {
  reveal: AnswerReveal;
  lang: StudentLang;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const showHindi = reveal.answeredInHindi || lang === 'hi';
  const title = headline(reveal);
  const bodyId = `reveal-${reveal.questionId}`;

  if (collapsible) {
    return (
      <Panel className="overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="focus-ring flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.02] sm:px-5"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <BookOpenCheck className="h-4 w-4 shrink-0 text-mint-300" />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium text-white/85">
                Question {reveal.index} · see the correct answer
              </span>
              {showHindi && (
                <span lang="hi" className="hindi-text block text-[12.5px] text-white/50">
                  प्रश्न {reveal.index} · सही उत्तर देखें
                </span>
              )}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <OutcomeBadge reveal={reveal} />
            <ChevronDown className={cx('h-4 w-4 text-white/50 transition', open && 'rotate-180')} />
          </span>
        </button>
        {open && (
          <div id={bodyId} className="border-t border-white/[0.06] p-4 sm:p-5">
            <Bilingual en={reveal.prompt} hi={reveal.hindi?.prompt} showHindi={showHindi} className="mb-4 text-[14px] leading-relaxed text-white/80" />
            <RevealBody reveal={reveal} showHindi={showHindi} />
          </div>
        )}
      </Panel>
    );
  }

  return (
    <div aria-live="polite">
    <Panel className="relative overflow-hidden p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mint-500/[0.12] text-mint-300 ring-1 ring-inset ring-mint-400/25">
            {reveal.feedback ? <Sparkles className="h-4 w-4" /> : <BookOpenCheck className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <Label en="The correct answer" hi="सही उत्तर" showHindi={showHindi} className="text-mint-300/85" />
            <p className="mt-1 text-[15px] font-medium text-white">{title.en}</p>
            {showHindi && (
              <p lang="hi" className="hindi-text text-[14px] text-white/65">
                {title.hi}
              </p>
            )}
          </div>
        </div>
        <OutcomeBadge reveal={reveal} />
      </div>
      <div className="mt-4">
        <RevealBody reveal={reveal} showHindi={showHindi} />
      </div>
    </Panel>
    </div>
  );
}
