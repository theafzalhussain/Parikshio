'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Radio, Send, Timer } from 'lucide-react';
import type { Exam, Question } from '@shared/types';
import { api, ApiError, cx } from '@/lib/api';
import { Button } from './ui/Button';
import { GroupLabel, Input, Label } from './ui/Field';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toast';
import { StatusPill } from './ui/Pills';

interface Props {
  open: boolean;
  onClose: () => void;
  question: Pick<Question, 'id' | 'prompt' | 'type' | 'timerSeconds' | 'points'> | null;
  /** called after a successful push so parent lists can refresh */
  onPushed?: () => void;
}

type ExamRow = Exam & { participation: number };

export function PushDialog({ open, onClose, question, onPushed }: Props) {
  const { push } = useToast();
  const [exams, setExams] = useState<ExamRow[] | null>(null);
  const [examId, setExamId] = useState('');
  const [timer, setTimer] = useState(question?.timerSeconds ?? 60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushedTo, setPushedTo] = useState<{ id: string; title: string; code: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPushedTo(null);
    setTimer(question?.timerSeconds ?? 60);
    api<{ exams: ExamRow[] }>('/exams')
      .then((res) => {
        const open = res.exams.filter((e) => e.status !== 'ended');
        setExams(open);
        setExamId((prev) => prev || open.find((e) => e.status === 'live')?.id || open[0]?.id || '');
      })
      .catch((err: Error) => setError(err.message));
  }, [open, question?.timerSeconds]);

  async function submit() {
    if (!question || !examId) return;
    setBusy(true);
    setError(null);
    try {
      // make sure the session actually contains this question (idempotent)
      await api(`/exams/${examId}/questions`, { method: 'POST', body: { questionId: question.id } });
      await api(`/exams/${examId}/push`, {
        method: 'POST',
        body: { questionId: question.id, timerSeconds: timer }
      });
      const exam = exams?.find((e) => e.id === examId);
      setPushedTo({ id: examId, title: exam?.title ?? 'Session', code: exam?.code ?? '' });
      push({
        kind: 'success',
        title: 'Question pushed live',
        body: `${timer}s timer started on every student device in ${exam?.code ?? 'the session'}.`
      });
      onPushed?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not push this question');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Push this question live"
      description={question ? question.prompt.slice(0, 120) : undefined}
      width="max-w-lg"
      footer={
        pushedTo ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Link
              href={`/admin/exams/${pushedTo.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-gradient-to-b from-lime-300 to-lime-500 px-3 text-[12.5px] font-medium text-ink-950"
            >
              Open control room <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="lime" size="sm" loading={busy} onClick={submit} disabled={!examId}>
              <Send className="h-3.5 w-3.5" /> Push now
            </Button>
          </>
        )
      }
    >
      {pushedTo ? (
        <div className="rounded-2xl border border-lime-400/25 bg-lime-400/[0.07] p-4">
          <p className="flex items-center gap-2 text-[13px] font-medium text-lime-200">
            <Radio className="h-4 w-4" /> Live in {pushedTo.title}
          </p>
          <p className="mt-1.5 text-[12px] text-white/45">
            Join code <span className="font-mono text-white/70">{pushedTo.code}</span> · students see it instantly with a
            synchronised {timer}s timer.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <GroupLabel id="push-target-session" hint={`${exams?.length ?? 0} open sessions`}>
              Target session
            </GroupLabel>
            <div
              role="group"
              aria-labelledby="push-target-session"
              className="max-h-[220px] space-y-2 overflow-y-auto pr-1"
            >
              {!exams && <p className="py-4 text-center text-[12px] text-white/30">Loading sessions…</p>}
              {exams && exams.length === 0 && (
                <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-[12px] text-white/45">
                  No open sessions yet. Create one from <span className="text-white/70">Live sessions</span> — or publish
                  this paper from its workspace in one click.
                </p>
              )}
              {exams?.map((exam) => (
                <button
                  key={exam.id}
                  type="button"
                  onClick={() => setExamId(exam.id)}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition',
                    examId === exam.id
                      ? 'border-aurora-400/50 bg-aurora-500/[0.1]'
                      : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-white/85">{exam.title}</span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-white/35">
                      {exam.subject} · <span className="font-mono">{exam.code}</span> · {exam.questionIds.length} Q
                    </span>
                  </span>
                  <StatusPill status={exam.status} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="push-timer" hint="seconds · overrides the bank default">
              Timer for this push
            </Label>
            <div className="relative">
              <Timer className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
              <Input
                id="push-timer"
                type="number"
                min={5}
                max={3600}
                value={timer}
                onChange={(e) => setTimer(Number(e.target.value))}
                className="pl-9"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[20, 30, 45, 60, 120, 180].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTimer(preset)}
                  className={cx(
                    'rounded-lg border px-2 py-1 text-[11px] transition',
                    timer === preset
                      ? 'border-lime-400/40 bg-lime-400/10 text-lime-200'
                      : 'border-white/[0.08] text-white/45 hover:border-white/25 hover:text-white/80'
                  )}
                >
                  {preset}s
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-3 py-2 text-[12px] text-ember-400">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
