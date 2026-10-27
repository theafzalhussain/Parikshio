'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Hourglass,
  Lock,
  Radio,
  Send,
  Sparkles,
  Timer,
  Trophy,
  Wifi,
  Zap
} from 'lucide-react';
import { StudentShell } from '@/components/StudentShell';
import { RadialTimer } from '@/components/charts/Charts';
import { Leaderboard } from '@/components/Leaderboard';
import { Badge, Panel, SectionHead } from '@/components/ui/Panel';
import { Button, LinkButton } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Field';
import { Loading, TypePill, typeLabel } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, cx } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useServerClock, useSocket } from '@/lib/socket';
import type { ExamPublic, LeaderboardEntry, StudentQuestion } from '@shared/types';

const fmtClock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export default function StudentExamPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? '').toString().toUpperCase();
  const router = useRouter();
  const { user } = useAuth();
  const socket = useSocket();
  const { now, synced } = useServerClock(socket);
  const { push } = useToast();

  const [exam, setExam] = useState<ExamPublic | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [draft, setDraft] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const warned = useRef<string | null>(null);
  const lastQuestion = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ exam: ExamPublic }>(`/student/exams/by-code/${code}`);
      setExam(res.exam);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open this exam');
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  // realtime
  useEffect(() => {
    socket.emit('join:exam', { examCode: code, role: 'student' });

    const onState = (payload: ExamPublic) => {
      if (payload.code !== code) return;
      setExam(payload);
    };
    const onPushed = (payload: { examId: string; active: NonNullable<ExamPublic['active']> }) => {
      setExam((prev) => (prev ? { ...prev, status: 'live', active: payload.active } : prev));
      push({
        kind: 'info',
        title: 'New question pushed',
        body: `${payload.active.question.timerSeconds}s on the clock — go.`
      });
    };
    const onLocked = (payload: { examId: string }) => {
      setExam((prev) => (prev && prev.active ? { ...prev, active: { ...prev.active, locked: true } } : prev));
      void load();
    };
    const onEnded = () => void load();
    const onBoard = (payload: { entries: LeaderboardEntry[] }) => setBoard(payload.entries);

    socket.on('exam:state', onState);
    socket.on('question:pushed', onPushed);
    socket.on('question:locked', onLocked);
    socket.on('exam:ended', onEnded);
    socket.on('leaderboard:update', onBoard);
    return () => {
      socket.off('exam:state', onState);
      socket.off('question:pushed', onPushed);
      socket.off('question:locked', onLocked);
      socket.off('exam:ended', onEnded);
      socket.off('leaderboard:update', onBoard);
    };
  }, [socket, code, load, push]);

  const active = exam?.active ?? null;
  const question: StudentQuestion | null = active?.question ?? null;
  const remaining = active ? Math.max(0, active.endsAt - now) : 0;
  const totalMs = active ? active.endsAt - active.pushedAt : 0;
  const secondsLeft = Math.ceil(remaining / 1000);
  const urgent = !!active && !active.locked && remaining <= 10_000;
  const myAnswer = active ? exam?.myAnswers[active.questionId] : undefined;
  const answered = !!myAnswer;
  const expired = !!active && (active.locked || remaining <= 0);

  // reset draft when a new question arrives
  useEffect(() => {
    if (question && lastQuestion.current !== question.id) {
      lastQuestion.current = question.id;
      setDraft('');
      warned.current = null;
    }
  }, [question]);

  // 10-second warning
  useEffect(() => {
    if (!active || answered || active.locked) return;
    if (secondsLeft <= 10 && secondsLeft > 0 && warned.current !== active.questionId) {
      warned.current = active.questionId;
      push({ kind: 'warn', title: '10 seconds left', body: 'Submit your answer now.' });
    }
  }, [secondsLeft, active, answered, push]);

  const canSubmit = useMemo(() => {
    if (!question || answered || expired) return false;
    if (question.type === 'mcq' || question.type === 'truefalse' || question.type === 'fill') return draft.trim().length > 0;
    return draft.trim().length > 1;
  }, [question, answered, expired, draft]);

  async function submit() {
    if (!exam || !question || !canSubmit) return;
    setSubmitting(true);
    try {
      const payload =
        question.type === 'mcq' || question.type === 'truefalse' ? draft : draft.trim();
      const res = await api<{ exam: ExamPublic; leaderboard: LeaderboardEntry[]; response: { latencyMs: number } }>(
        '/student/answers',
        { method: 'POST', body: { examId: exam.id, questionId: question.id, answer: payload } }
      );
      setExam(res.exam);
      setBoard(res.leaderboard);
      push({
        kind: 'success',
        title: 'Answer locked in',
        body: `Recorded in ${(res.response.latencyMs / 1000).toFixed(1)}s. Result unlocks when the question closes.`
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not submit';
      push({ kind: 'error', title: 'Submission rejected', body: message });
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const progressPct = active ? Math.round((active.index / active.total) * 100) : 0;

  /* ── states ─────────────────────────────────────────────── */

  if (error) {
    return (
      <StudentShell>
        <Panel className="mx-auto max-w-md p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-ember-500/10 text-ember-400">
            <Lock className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-[16px] font-semibold text-white">This exam is not accessible</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/45">{error}</p>
          <LinkButton href="/student" variant="lime" size="sm" className="mt-5">
            Back to lobby
          </LinkButton>
        </Panel>
      </StudentShell>
    );
  }

  if (!exam) {
    return (
      <StudentShell>
        <Panel className="p-6">
          <Loading label="Connecting to the exam room" />
        </Panel>
      </StudentShell>
    );
  }

  /* ── ended / result ─────────────────────────────────────── */
  if (exam.status === 'ended') {
    const mine = Object.values(exam.myAnswers);
    const points = mine.reduce((a, b) => a + b.awarded, 0);
    const correct = mine.filter((m) => m.grade === 'correct').length;
    const pending = mine.filter((m) => m.grade === 'pending').length;
    const me = board.find((b) => b.studentId === user?.id);
    return (
      <StudentShell>
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex items-center justify-between">
            <Link href="/student" className="inline-flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> Lobby
            </Link>
            <Badge tone="neutral">session ended</Badge>
          </div>

          <Panel className="relative overflow-hidden p-7 text-center sm:p-9">
            <div className="absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-lime-400/15 blur-3xl" />
            <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-lime-400/15 text-lime-300 ring-1 ring-inset ring-lime-400/30">
              <Trophy className="h-6 w-6" />
            </span>
            <p className="eyebrow relative mt-5">{exam.subject}</p>
            <h1 className="relative mt-1 text-[1.6rem] font-semibold text-white">{exam.title}</h1>
            <p className="relative mt-1 text-[12.5px] text-white/40">Session {exam.code} has closed.</p>

            <div className="relative mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                { k: 'points', v: points },
                { k: 'answered', v: `${mine.length}/${exam.totalQuestions}` },
                { k: 'correct', v: correct },
                { k: 'rank', v: me ? `#${me.rank}` : '—' }
              ].map((s) => (
                <div key={s.k} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5">
                  <p className="num text-[20px] font-semibold text-white">{s.v}</p>
                  <p className="text-[9.5px] uppercase tracking-[0.14em] text-white/30">{s.k}</p>
                </div>
              ))}
            </div>

            {pending > 0 && (
              <p className="relative mt-4 text-[11.5px] text-amber-300/80">
                {pending} long-form answer{pending > 1 ? 's are' : ' is'} awaiting manual review.
              </p>
            )}

            <div className="relative mt-6 flex flex-wrap justify-center gap-2">
              <LinkButton href="/student" variant="lime" size="sm">
                Back to lobby
              </LinkButton>
              <LinkButton href="/student" variant="ghost" size="sm">
                <Sparkles className="h-3.5 w-3.5" /> Join another session
              </LinkButton>
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHead eyebrow="Cohort" title="Final leaderboard" />
            <div className="mt-3">
              <Leaderboard entries={board} highlightId={user?.id} max={10} />
            </div>
          </Panel>
        </div>
      </StudentShell>
    );
  }

  /* ── waiting room ───────────────────────────────────────── */
  if (!active) {
    return (
      <StudentShell maxWidth="max-w-4xl">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Link href="/student" className="inline-flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> Leave room
            </Link>
            <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-white/35">
              <Wifi className="h-3 w-3 text-mint-400" /> connected · {synced ? 'clock synced' : 'syncing'}
            </span>
          </div>

          <Panel className="relative overflow-hidden p-8 text-center sm:p-12">
            <div className="absolute inset-0 dot-veil opacity-30" />
            <div className="relative mx-auto grid h-16 w-16 animate-pulseRing place-items-center rounded-full bg-lime-400/10 text-lime-300 ring-1 ring-inset ring-lime-400/30">
              <Hourglass className="h-7 w-7" />
            </div>
            <h1 className="relative mt-6 text-[1.5rem] font-semibold text-white sm:text-[1.8rem]">You are in the room</h1>
            <p className="relative mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-white/45">
              {exam.title} · {exam.totalQuestions} questions. Keep this tab open — the question appears here the moment
              your faculty pushes it.
            </p>
            <div className="relative mx-auto mt-6 flex max-w-sm items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <span className="text-[11px] uppercase tracking-[0.14em] text-white/35">room code</span>
              <span className="font-mono text-[15px] tracking-[0.3em] text-lime-300">{exam.code}</span>
            </div>
            <div className="relative mt-4 flex items-center justify-center gap-2 text-[11.5px] text-white/30">
              <Radio className="h-3.5 w-3.5 animate-pulse text-lime-400" />
              listening for the first push…
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHead eyebrow="Leaderboard" title="Cohort standings" sub="Ranked by accuracy, then speed." />
            <div className="mt-3">
              <Leaderboard entries={board} highlightId={user?.id} max={8} />
            </div>
          </Panel>
        </div>
      </StudentShell>
    );
  }

  /* ── live question ──────────────────────────────────────── */
  const isObjective = question?.type === 'mcq' || question?.type === 'truefalse';

  return (
    <StudentShell maxWidth="max-w-6xl">
      <div className="space-y-4">
        {/* status strip */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Badge tone="lime" dot>live</Badge>
            <span className="text-[12px] text-white/45">
              {exam.title} · <span className="font-mono">{exam.code}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="num text-[11.5px] text-white/35">
              Question {active.index} of {active.total}
            </span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-aurora-400 to-lime-400 transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
          {/* question column */}
          <div className="space-y-4">
            <Panel
              className={cx(
                'relative overflow-hidden transition',
                urgent && 'ring-1 ring-ember-500/40',
                expired && 'opacity-95'
              )}
            >
              {/* timer bar */}
              <div className="relative h-1 w-full bg-white/[0.06]">
                <div
                  className={cx(
                    'h-full transition-[width] duration-300 ease-linear',
                    urgent ? 'bg-gradient-to-r from-ember-500 to-amber-400' : 'bg-gradient-to-r from-lime-400 to-mint-400'
                  )}
                  style={{ width: `${totalMs ? Math.max(0, Math.min(100, (remaining / totalMs) * 100)) : 0}%` }}
                />
              </div>

              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <TypePill type={question!.type} />
                  <span className="text-[11px] text-white/35">{typeLabel(question!.type)}</span>
                  <span className="num text-[11px] text-white/30">· {question!.points} pts</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      'num text-[15px] font-semibold',
                      urgent ? 'text-ember-400' : 'text-white'
                    )}
                  >
                    {expired ? '0:00' : fmtClock(remaining)}
                  </span>
                  <Timer className={cx('h-3.5 w-3.5', urgent ? 'text-ember-400' : 'text-white/25')} />
                  {synced && <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/25">server</span>}
                </div>
              </div>

              <div className="p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="num mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-[11px] font-semibold text-white/50">
                    {active.index}
                  </span>
                  <h2 className="text-[16px] font-medium leading-relaxed text-white sm:text-[17px]">
                    {question!.prompt}
                  </h2>
                </div>

                {/* answer inputs */}
                <div className="mt-5">
                  {isObjective && (
                    <div className="space-y-2.5">
                      {question!.options.map((option, i) => {
                        const selected = draft === String(i);
                        return (
                          <button
                            key={`${question!.id}-opt-${i}`}
                            type="button"
                            disabled={answered || expired}
                            onClick={() => setDraft(String(i))}
                            className={cx(
                              'group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition',
                              selected
                                ? 'border-aurora-400/60 bg-aurora-500/[0.12] shadow-[0_0_0_1px_rgba(158,130,255,0.25),0_10px_30px_-20px_rgba(124,92,255,0.9)]'
                                : 'border-white/[0.08] bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]',
                              (answered || expired) && !selected && 'opacity-45'
                            )}
                          >
                            <span
                              className={cx(
                                'grid h-8 w-8 shrink-0 place-items-center rounded-xl border text-[12px] font-semibold transition',
                                selected
                                  ? 'border-transparent bg-aurora-500 text-white'
                                  : 'border-white/15 text-white/40 group-hover:border-white/30'
                              )}
                            >
                              {selected ? <Check className="h-4 w-4" /> : String.fromCharCode(65 + i)}
                            </span>
                            <span className="text-[13.5px] leading-relaxed text-white/85">{option}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {question!.type === 'fill' && (
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      disabled={answered || expired}
                      placeholder="Type the missing word or value…"
                      className="py-3.5 text-[15px]"
                      autoFocus
                    />
                  )}

                  {question!.type === 'short' && (
                    <TextArea
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      disabled={answered || expired}
                      placeholder="Answer in one or two sentences…"
                      className="text-[14px]"
                      autoFocus
                    />
                  )}

                  {question!.type === 'long' && (
                    <div>
                      <TextArea
                        rows={9}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        disabled={answered || expired}
                        placeholder="Write your full answer. Show each step — this one is reviewed by your faculty."
                        className="text-[14px] leading-relaxed"
                        autoFocus
                      />
                      <div className="mt-1.5 flex justify-between text-[10.5px] text-white/25">
                        <span>Reviewed manually after the session</span>
                        <span className="num">{draft.trim().split(/\s+/).filter(Boolean).length} words</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* action */}
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                  {answered ? (
                    <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-mint-400/25 bg-mint-500/[0.08] px-3.5 py-3">
                      <CircleCheck className="h-4 w-4 shrink-0 text-mint-300" />
                      <p className="text-[12.5px] text-mint-100">
                        Answer recorded. Result unlocks when the question closes.
                      </p>
                    </div>
                  ) : expired ? (
                    <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-ember-500/25 bg-ember-500/[0.08] px-3.5 py-3">
                      <Lock className="h-4 w-4 shrink-0 text-ember-400" />
                      <p className="text-[12.5px] text-ember-400">
                        Time is up for this question. Wait for the next push.
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-[11px] text-white/30">
                        One submission per question · graded automatically for objective answers
                      </p>
                      <Button variant="lime" size="lg" onClick={submit} loading={submitting} disabled={!canSubmit}>
                        <Send className="h-4 w-4" /> Submit answer
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Panel>

            {answered && myAnswer && (
              <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-[10.5px] uppercase tracking-[0.14em] text-white/30">your submission</p>
                  <p className="mt-1 max-h-16 overflow-hidden text-[12.5px] leading-relaxed text-white/70">
                    {isObjective ? `Option ${String.fromCharCode(65 + Number(myAnswer.answer))} — ${question!.options[Number(myAnswer.answer)] ?? ''}` : myAnswer.answer}
                  </p>
                </div>
                {myAnswer.grade !== 'pending' ? (
                  <Badge tone={myAnswer.grade === 'correct' ? 'mint' : 'ember'}>
                    {myAnswer.grade === 'correct' ? `+${myAnswer.awarded} pts` : 'incorrect'}
                  </Badge>
                ) : (
                  <Badge tone="neutral">
                    <Hourglass className="h-3 w-3" /> awaiting result
                  </Badge>
                )}
              </Panel>
            )}
          </div>

          {/* side column */}
          <div className="space-y-4">
            <Panel className="hidden p-5 lg:block">
              <div className="flex flex-col items-center">
                <RadialTimer remaining={expired ? 0 : remaining} total={totalMs} size={164} urgent={urgent} />
                <p className="mt-2 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.16em] text-white/30">
                  <Zap className="h-3 w-3 text-lime-400" /> synced to server clock
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 text-center">
                  <p className="num text-[15px] font-semibold text-white">{question!.points}</p>
                  <p className="text-[9px] uppercase tracking-[0.12em] text-white/30">points</p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 text-center">
                  <p className="num text-[15px] font-semibold text-white">{Math.round(totalMs / 1000)}s</p>
                  <p className="text-[9px] uppercase tracking-[0.12em] text-white/30">allowance</p>
                </div>
              </div>
            </Panel>

            <Panel className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="eyebrow">Live rank</p>
                  <h3 className="mt-1 text-[14px] font-semibold text-white">Cohort standings</h3>
                </div>
                <Trophy className="h-4 w-4 text-lime-300/70" />
              </div>
              <div className="mt-3">
                <Leaderboard entries={board} highlightId={user?.id} max={8} compact />
              </div>
            </Panel>

            <Panel className="p-4">
              <p className="flex items-center gap-2 text-[11px] text-white/35">
                <Wifi className="h-3.5 w-3.5 text-mint-400" />
                Keep this tab in focus. Submissions close automatically when the timer ends.
              </p>
            </Panel>
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
