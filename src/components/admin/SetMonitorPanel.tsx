'use client';

import { useState } from 'react';
import { CircleStop, Hourglass, Layers, RotateCcw, Timer, Users } from 'lucide-react';
import type { Question, SetMonitor } from '@shared/types';
import { api, ApiError, cx, fmtRelative } from '@/lib/api';
import { clampTimer, fmtClock, fmtDuration, MAX_TIMER, MIN_TIMER, TIMER_PRESETS } from '@/lib/time';
import { Badge, Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Avatar, TypePill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';

/**
 * Control-room view of the latest self-paced set: who is inside which
 * question right now, how each question is going, and the two admin levers —
 * re-open a question for students who missed it, or close the whole set.
 */
export function SetMonitorPanel({
  examId,
  monitor,
  questions,
  now,
  onChanged
}: {
  examId: string;
  monitor: SetMonitor;
  questions: Question[];
  now: number;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [repushId, setRepushId] = useState<string | null>(null);
  const [repushTimer, setRepushTimer] = useState(60);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const { set } = monitor;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const totals = monitor.items.reduce(
    (acc, row) => ({
      answered: acc.answered + row.answered,
      inProgress: acc.inProgress + row.inProgress,
      missed: acc.missed + row.missed
    }),
    { answered: 0, inProgress: 0, missed: 0 }
  );
  const repushItem = set.items.find((item) => item.questionId === repushId);
  const repushStats = monitor.items.find((row) => row.questionId === repushId);

  async function repush() {
    if (!repushId) return;
    setBusy(true);
    try {
      const res = await api<{ reopened: number }>(`/exams/${examId}/set/repush`, {
        method: 'POST',
        body: { questionId: repushId, timerSeconds: clampTimer(repushTimer) }
      });
      push({
        kind: 'success',
        title: 'Question re-opened',
        body: res.reopened
          ? `${res.reopened} student${res.reopened === 1 ? '' : 's'} can answer it again with ${fmtDuration(repushTimer)}.`
          : `Timer set to ${fmtDuration(repushTimer)} for anyone who has not opened it yet.`
      });
      setRepushId(null);
      onChanged();
    } catch (err) {
      push({ kind: 'error', title: 'Could not re-open', body: err instanceof ApiError ? err.message : 'Try again' });
    } finally {
      setBusy(false);
    }
  }

  async function closeSet() {
    setBusy(true);
    try {
      await api(`/exams/${examId}/set/close`, { method: 'POST' });
      push({ kind: 'info', title: 'Set closed', body: 'Nothing new can start. Results are now visible to students.' });
      setConfirmClose(false);
      onChanged();
    } catch (err) {
      push({ kind: 'error', title: 'Could not close the set', body: err instanceof ApiError ? err.message : 'Try again' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="gold-edge overflow-hidden" >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-white/[0.02] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-400/[0.1] text-gold-200 ring-1 ring-inset ring-gold-300/30">
            <Layers className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">Self-paced set</p>
            <h3 className="mt-1 font-display text-[19px] font-medium leading-tight text-white">
              {set.items.length} questions · pushed {fmtRelative(set.pushedAt)}
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {set.closed ? (
            <Badge tone="neutral">closed</Badge>
          ) : (
            <>
              <Badge tone="gold" dot>
                open
              </Badge>
              <Button variant="danger" size="sm" onClick={() => setConfirmClose(true)}>
                <CircleStop className="h-3.5 w-3.5" /> Close set
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 p-5 sm:grid-cols-4">
        {[
          { k: 'students', v: monitor.students, tone: 'text-white' },
          { k: 'answered', v: totals.answered, tone: 'text-mint-300' },
          { k: 'working now', v: totals.inProgress, tone: 'text-royal-200' },
          { k: 'missed', v: totals.missed, tone: 'text-ember-300' }
        ].map((s) => (
          <div key={s.k} className="rounded-xl border border-white/[0.07] bg-ink-950/40 p-3">
            <p className={cx('num text-[20px] font-semibold leading-none', s.tone)}>{s.v}</p>
            <p className="mt-1.5 text-[11px] uppercase tracking-[0.12em] text-white/50">{s.k}</p>
          </div>
        ))}
      </div>

      {monitor.inProgress.length > 0 && (
        <div className="border-t border-white/[0.06] px-5 py-4">
          <p className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">
            <Users className="h-3.5 w-3.5 text-royal-300" /> Inside a question right now
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {monitor.inProgress.slice(0, 12).map((row) => {
              const left = row.deadline - now;
              return (
                <li
                  key={`${row.studentId}:${row.questionId}`}
                  className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <Avatar name={row.studentName} size={26} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{row.studentName}</span>
                  <span className="num rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11.5px] text-white/70">Q{row.index}</span>
                  <span className={cx('num w-11 text-right text-[13px] font-medium', left <= 10_000 ? 'text-ember-300' : 'text-white/85')}>
                    {fmtClock(left)}
                  </span>
                </li>
              );
            })}
          </ul>
          {monitor.inProgress.length > 12 && (
            <p className="mt-2 text-[12px] text-white/45">+{monitor.inProgress.length - 12} more</p>
          )}
        </div>
      )}

      <ol className="space-y-2 border-t border-white/[0.06] p-5">
        {set.items.map((item, i) => {
          const question = byId.get(item.questionId);
          const stats = monitor.items.find((row) => row.questionId === item.questionId);
          return (
            <li
              key={item.questionId}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3"
            >
              <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold-400/[0.1] font-display text-[14px] text-gold-200 ring-1 ring-inset ring-gold-300/25">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-[13.5px] text-white/85">{question?.prompt ?? 'Question removed'}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {question && <TypePill type={question.type} />}
                  <span className="num inline-flex items-center gap-1 text-[12px] text-white/50">
                    <Timer className="h-3 w-3" /> {fmtDuration(item.timerSeconds)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[12px]">
                <span className="num rounded-full bg-mint-500/[0.13] px-2 py-0.5 text-mint-300" title="answered">
                  ✓ {stats?.answered ?? 0}
                </span>
                <span className="num rounded-full bg-royal-500/[0.14] px-2 py-0.5 text-royal-100" title="working now">
                  <Hourglass className="mr-0.5 inline h-3 w-3" />
                  {stats?.inProgress ?? 0}
                </span>
                <span className="num rounded-full bg-ember-500/[0.13] px-2 py-0.5 text-ember-300" title="ran out of time or skipped">
                  ✕ {stats?.missed ?? 0}
                </span>
              </div>
              {!set.closed && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRepushId(item.questionId);
                    setRepushTimer(item.timerSeconds);
                  }}
                  title="Give students who missed it another chance"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Re-open
                </Button>
              )}
            </li>
          );
        })}
      </ol>

      <Modal
        open={!!repushItem}
        onClose={() => setRepushId(null)}
        title="Re-open this question"
        description={
          repushStats?.missed
            ? `${repushStats.missed} student${repushStats.missed === 1 ? '' : 's'} ran out of time or skipped it. They can open it again with the timer below. Answers already given stay as they are.`
            : 'Nobody has missed it yet. You can still change its timer for students who have not opened it.'
        }
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRepushId(null)}>
              Cancel
            </Button>
            <Button variant="gold" size="sm" loading={busy} onClick={repush}>
              <RotateCcw className="h-3.5 w-3.5" /> Re-open
            </Button>
          </>
        }
      >
        <Label htmlFor="repush-timer" hint={`${MIN_TIMER}–${MAX_TIMER} seconds`}>
          Time allowed
        </Label>
        <Input
          id="repush-timer"
          type="number"
          min={MIN_TIMER}
          max={MAX_TIMER}
          value={repushTimer}
          onChange={(e) => setRepushTimer(Number(e.target.value))}
          onBlur={() => setRepushTimer((v) => clampTimer(v))}
        />
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {TIMER_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setRepushTimer(preset)}
              className={cx(
                'focus-ring rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
                repushTimer === preset
                  ? 'border-gold-300/45 bg-gold-400/[0.12] text-gold-100'
                  : 'border-white/[0.08] text-white/60 hover:border-white/25 hover:text-white'
              )}
            >
              {fmtDuration(preset)}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Close this set?"
        description="Students cannot start any more questions from it, and anyone inside a question right now is stopped — answers already on their way are still accepted. Results become visible to students."
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>
              Keep it open
            </Button>
            <Button variant="danger" size="sm" loading={busy} onClick={closeSet}>
              <CircleStop className="h-3.5 w-3.5" /> Close set
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-white/65">
          {totals.inProgress} student{totals.inProgress === 1 ? ' is' : 's are'} inside a question right now.
        </p>
      </Modal>
    </Panel>
  );
}
