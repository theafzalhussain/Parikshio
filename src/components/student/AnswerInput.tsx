'use client';

import { useEffect } from 'react';
import { Check } from 'lucide-react';
import type { StudentQuestion } from '@shared/types';
import { Input, TextArea } from '@/components/ui/Field';
import { cx } from '@/lib/api';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

/**
 * The answer control for one question, shared by the live view and the
 * self-paced set view so both behave the same way.
 *
 * Keyboard: A–Z or 1–9 picks an option, Enter submits; in a text field Enter
 * submits a one-line answer and Ctrl/⌘+Enter submits a written one.
 */
export function AnswerInput({
  question,
  draft,
  onDraft,
  disabled,
  onSubmitShortcut
}: {
  question: StudentQuestion;
  draft: string;
  onDraft: (value: string) => void;
  disabled: boolean;
  onSubmitShortcut?: () => void;
}) {
  const objective = question.type === 'mcq' || question.type === 'truefalse';

  useEffect(() => {
    if (!objective || disabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      // Dialogs own the keyboard while they are open.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const key = event.key.toUpperCase();
      let index = -1;
      if (/^[1-9]$/.test(key)) index = Number(key) - 1;
      else if (/^[A-Z]$/.test(key)) index = key.charCodeAt(0) - 65;
      if (index >= 0 && index < question.options.length) {
        event.preventDefault();
        onDraft(String(index));
        return;
      }
      if (event.key === 'Enter' && onSubmitShortcut) {
        // Enter on a focused button already clicks it; don't submit twice.
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        onSubmitShortcut();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [objective, disabled, question.options.length, onDraft, onSubmitShortcut]);

  if (objective) {
    return (
      <div className="space-y-2.5" role="group" aria-label="Answer options">
        {question.options.map((option, i) => {
          const selected = draft === String(i);
          return (
            <button
              key={`${question.id}-opt-${i}`}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onDraft(String(i))}
              className={cx(
                'group flex w-full items-center gap-3.5 rounded-2xl border px-4 py-4 text-left transition duration-200 focus-ring',
                selected
                  ? 'border-royal-400/60 bg-royal-500/[0.13] shadow-[0_0_0_1px_rgba(129,151,255,0.25),0_12px_32px_-20px_rgba(98,121,245,0.9)]'
                  : 'border-white/[0.09] bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.045]',
                disabled && !selected && 'opacity-45'
              )}
            >
              <span
                className={cx(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-[14px] font-semibold transition',
                  selected
                    ? 'border-transparent bg-royal-500 text-white'
                    : 'border-white/15 text-white/60 group-hover:border-gold-200/40 group-hover:text-gold-100'
                )}
              >
                {selected ? <Check className="h-4 w-4" /> : String.fromCharCode(65 + i)}
              </span>
              <span className="text-[15px] leading-relaxed text-white/90">{option}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === 'fill') {
    return (
      <Input
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmitShortcut) {
            e.preventDefault();
            onSubmitShortcut();
          }
        }}
        disabled={disabled}
        placeholder="Type the missing word or value…"
        aria-label="Your answer"
        className="py-3.5 text-[16px] sm:text-[16px]"
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />
    );
  }

  const long = question.type === 'long';
  return (
    <div>
      <TextArea
        rows={long ? 9 : 3}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmitShortcut) {
            e.preventDefault();
            onSubmitShortcut();
          }
        }}
        disabled={disabled}
        placeholder={
          long
            ? 'Write your full answer. Show each step — this one is reviewed carefully.'
            : 'Answer in one or two sentences…'
        }
        aria-label="Your answer"
        className="text-[15px] leading-relaxed sm:text-[15px]"
        autoFocus
      />
      <div className="mt-1.5 flex justify-between text-[12px] text-white/45">
        <span>{long ? 'Reviewed after the question closes' : 'Ctrl + Enter to submit'}</span>
        <span className="num">{draft.trim().split(/\s+/).filter(Boolean).length} words</span>
      </div>
    </div>
  );
}

/** The one-line hint shown under objective questions. */
export function ShortcutHint({ type }: { type: StudentQuestion['type'] }) {
  if (type !== 'mcq' && type !== 'truefalse') return null;
  return (
    <p className="mt-3 hidden text-[12px] text-white/40 md:block">
      Tip: press <kbd className="rounded border border-white/15 bg-white/[0.05] px-1 font-mono text-[11px]">A</kbd>–
      <kbd className="rounded border border-white/15 bg-white/[0.05] px-1 font-mono text-[11px]">D</kbd> to choose,{' '}
      <kbd className="rounded border border-white/15 bg-white/[0.05] px-1 font-mono text-[11px]">Enter</kbd> to submit.
    </p>
  );
}
