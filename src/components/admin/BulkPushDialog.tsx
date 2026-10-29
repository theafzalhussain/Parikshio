'use client';

import { useEffect, useMemo, useState } from 'react';
import { Layers, Send, Timer } from 'lucide-react';
import type { ExamSettings, Question, QuestionSetOptions } from '@shared/types';
import { api, ApiError, cx } from '@/lib/api';
import { clampTimer, fmtDuration, MAX_TIMER, MIN_TIMER, TIMER_PRESETS } from '@/lib/time';
import { Button } from '@/components/ui/Button';
import { GroupLabel, Input, Label, SegmentedControl, Toggle } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { StatusPill, TypePill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';

type SessionRow = { id: string; title: string; code: string; status: 'draft' | 'live' | 'ended'; subject: string; settings?: ExamSettings };

const FALLBACK_OPTIONS: QuestionSetOptions = { revealPrompts: true, autoAdvance: true, allowSkip: true };

/**
 * Push several questions at once as a self-paced set. Used from the control
 * room (session fixed) and from the question bank (pick the session here).
 *
 * Timers: one shared value for every question, or one per question. Either
 * way, each timer starts only when a student opens that question.
 */
export function BulkPushDialog({
  open,
  onClose,
  questions,
  examId,
  initialTimers,
  defaults,
  onPushed
}: {
  open: boolean;
  onClose: () => void;
  questions: Question[];
  /** Fixed target session. When absent, the dialog lists open sessions to choose from. */
  examId?: string;
  /** Per-question timer overrides already typed elsewhere (e.g. the control room queue). */
  initialTimers?: Record<string, number>;
  defaults?: QuestionSetOptions;
  onPushed?: (examId: string) => void;
}) {
  const { push } = useToast();
  const [mode, setMode] = useState<'same' | 'each'>('same');
  const [shared, setShared] = useState(60);
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [options, setOptions] = useState<QuestionSetOptions>(defaults ?? FALLBACK_OPTIONS);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [target, setTarget] = useState(examId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the dialog opens with a new selection.
  useEffect(() => {
    if (!open) return;
    setError(null);
    const next: Record<string, number> = {};
    questions.forEach((q) => {
      next[q.id] = clampTimer(initialTimers?.[q.id] ?? q.timerSeconds);
    });
    setTimers(next);
    const values = Object.values(next);
    // Start in "individual" mode when the questions already differ.
    const allSame = values.every((v) => v === values[0]);
    setMode(allSame ? 'same' : 'each');
    setShared(values[0] ?? 60);
    setOptions(defaults ?? FALLBACK_OPTIONS);
    setTarget(examId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Session picker (question bank only).
  useEffect(() => {
    if (!open || examId) return;
    setSessions(null);
    api<{ exams: SessionRow[] }>('/exams')
      .then((res) => {
        const usable = res.exams.filter((e) => e.status !== 'ended');
        setSessions(usable);
        setTarget((prev) => prev || usable.find((e) => e.status === 'live')?.id || usable[0]?.id || '');
      })
      .catch((err: Error) => setError(err.message));
  }, [open, examId]);

  // Picking a session in the bank adopts that session's own defaults.
  useEffect(() => {
    if (examId || !sessions) return;
    const chosen = sessions.find((s) => s.id === target);
    if (chosen?.settings?.setDefaults) setOptions(chosen.settings.setDefaults);
  }, [target, sessions, examId]);

  const effective = (q: Question) => (mode === 'same' ? clampTimer(shared) : clampTimer(timers[q.id] ?? q.timerSeconds));
  const totalSeconds = useMemo(
    () => questions.reduce((sum, q) => sum + effective(q), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, mode, shared, timers]
  );

  async function submit() {
    if (!target || questions.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/exams/${target}/push-set`, {
        method: 'POST',
        body: {
          items: questions.map((q) => ({ questionId: q.id, timerSeconds: effective(q) })),
          ...options
        }
      });
      push({
        kind: 'success',
        title: `${questions.length} question${questions.length === 1 ? '' : 's'} pushed`,
        body: 'Students see the full list now. Each timer starts when a student opens that question.'
      });
      onPushed?.(target);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not push these questions');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Push ${questions.length} question${questions.length === 1 ? '' : 's'} together`}
      description="Students see every question at once and choose the order. A question's timer starts only when a student opens it."
      width="max-w-3xl"
      footer={
        <>
          <span className="mr-auto text-[13px] text-white/60">
            {questions.length} questions · up to <span className="num font-medium text-white/85">{fmtDuration(totalSeconds)}</span> per student
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" size="sm" loading={busy} onClick={submit} disabled={!target || questions.length === 0}>
            <Send className="h-3.5 w-3.5" /> Push {questions.length} now
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {!examId && (
          <div>
            <GroupLabel id="bulk-target" hint={sessions ? `${sessions.length} open sessions` : undefined}>
              Session
            </GroupLabel>
            <div role="group" aria-labelledby="bulk-target" className="grid max-h-48 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {!sessions && <p className="py-3 text-[13px] text-white/50">Loading sessions…</p>}
              {sessions?.length === 0 && (
                <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-[13px] text-white/60 sm:col-span-2">
                  No open sessions. Create one from Live sessions first.
                </p>
              )}
              {sessions?.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setTarget(s.id)}
                  aria-pressed={target === s.id}
                  className={cx(
                    'focus-ring flex items-center gap-3 rounded-xl border p-3 text-left transition',
                    target === s.id
                      ? 'border-royal-400/55 bg-royal-500/[0.12]'
                      : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-white/90">{s.title}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-white/50">
                      {s.subject} · <span className="font-mono">{s.code}</span>
                    </span>
                  </span>
                  <StatusPill status={s.status} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <GroupLabel id="bulk-timer-mode">Timers</GroupLabel>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              options={[
                { value: 'same', label: 'Same for all' },
                { value: 'each', label: 'Per question' }
              ]}
            />
          </div>

          {mode === 'same' ? (
            <div className="rounded-2xl border border-white/[0.08] bg-ink-950/40 p-4">
              <Label htmlFor="bulk-shared-timer" hint={`${MIN_TIMER}–${MAX_TIMER} seconds`}>
                Time allowed for each question
              </Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-36">
                  <Timer className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <Input
                    id="bulk-shared-timer"
                    type="number"
                    min={MIN_TIMER}
                    max={MAX_TIMER}
                    value={shared}
                    onChange={(e) => setShared(Number(e.target.value))}
                    onBlur={() => setShared((v) => clampTimer(v))}
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TIMER_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setShared(preset)}
                      className={cx(
                        'focus-ring rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
                        shared === preset
                          ? 'border-gold-300/45 bg-gold-400/[0.12] text-gold-100'
                          : 'border-white/[0.08] text-white/60 hover:border-white/25 hover:text-white'
                      )}
                    >
                      {fmtDuration(preset)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <ol className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
              {questions.map((q, i) => (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5 sm:flex-nowrap"
                >
                  <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-[12px] font-semibold text-white/70">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-[13.5px] text-white/85">{q.prompt}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <TypePill type={q.type} />
                      <span className="text-[12px] text-white/50">{q.points} pts</span>
                    </span>
                  </span>
                  <div className="relative w-28 shrink-0">
                    <Timer className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                    <Input
                      type="number"
                      min={MIN_TIMER}
                      max={MAX_TIMER}
                      value={timers[q.id] ?? q.timerSeconds}
                      onChange={(e) => setTimers((prev) => ({ ...prev, [q.id]: Number(e.target.value) }))}
                      onBlur={() => setTimers((prev) => ({ ...prev, [q.id]: clampTimer(prev[q.id] ?? q.timerSeconds) }))}
                      className="py-2 pl-8 pr-2 sm:py-1.5"
                      aria-label={`Timer in seconds for question ${i + 1}`}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <GroupLabel id="bulk-options">How students work through the set</GroupLabel>
          <div role="group" aria-labelledby="bulk-options" className="grid gap-3 rounded-2xl border border-white/[0.08] bg-ink-950/40 p-4">
            <Toggle
              checked={options.revealPrompts}
              onChange={(v) => setOptions((o) => ({ ...o, revealPrompts: v }))}
              label="Show question text in the list before a student starts it"
            />
            <Toggle
              checked={options.autoAdvance}
              onChange={(v) => setOptions((o) => ({ ...o, autoAdvance: v }))}
              label="Start the next question automatically after each answer"
            />
            <Toggle
              checked={options.allowSkip}
              onChange={(v) => setOptions((o) => ({ ...o, allowSkip: v }))}
              label="Let students skip a question (it closes for them, like a timeout)"
            />
          </div>
          <p className="mt-2.5 flex items-start gap-2 text-[12.5px] leading-relaxed text-white/50">
            <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-300/70" />
            A question a student runs out of time on stays closed for them until you re-open it from the control room.
          </p>
        </div>

        {error && (
          <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-3.5 py-2.5 text-[13px] text-ember-300">{error}</p>
        )}
      </div>
    </Modal>
  );
}
