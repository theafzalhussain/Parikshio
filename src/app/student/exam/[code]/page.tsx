'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CircleCheck,
  CloudUpload,
  Hourglass,
  Layers,
  Lock,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Timer,
  Trophy,
  Wifi,
  WifiOff,
  XCircle,
  Zap
} from 'lucide-react';
import { StudentShell } from '@/components/StudentShell';
import { RadialTimer } from '@/components/charts/Charts';
import { Leaderboard } from '@/components/Leaderboard';
import { OfflineQueuePanel } from '@/components/OfflineQueuePanel';
import { AnswerInput, ShortcutHint } from '@/components/student/AnswerInput';
import { MobileTimerBar } from '@/components/student/MobileTimerBar';
import { ReviewList, describeAnswer } from '@/components/student/ReviewList';
import { SetRunner } from '@/components/student/SetRunner';
import { Badge, Panel, SectionHead } from '@/components/ui/Panel';
import { Button, LinkButton } from '@/components/ui/Button';
import { Loading, TypePill, typeLabel } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, cx } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  clearAnswerDraft,
  enqueueAnswer,
  flushOutbox,
  isTransportFailure,
  onSyncOutcome,
  readAnswerDraft,
  saveAnswerDraft,
  type AnswerReceipt
} from '@/lib/offlineQueue';
import { useOutbox } from '@/lib/useOutbox';
import { useServerClock, useSocket } from '@/lib/socket';
import { fmtClock } from '@/lib/time';
import type { ExamPublic, Grade, LeaderboardEntry, StudentQuestion } from '@shared/types';

export default function StudentExamPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? '').toString().toUpperCase();
  const router = useRouter();
  const { user } = useAuth();
  const socket = useSocket();
  const { now, synced } = useServerClock(socket);
  const { push } = useToast();
  const outbox = useOutbox(user?.id ?? null);

  const [exam, setExam] = useState<ExamPublic | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [draft, setDraft] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const warned = useRef<string | null>(null);
  const lastQuestion = useRef<string | null>(null);
  const pendingHiddenReport = useRef(false);
  /** The exam loaded at least once, so a later 404 means it was deleted, not mistyped. */
  const hadExam = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ exam: ExamPublic }>(`/student/exams/by-code/${code}`);
      hadExam.current = true;
      setExam(res.exam);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && hadExam.current) {
        // Deleted while this page was connecting, so the live event was missed.
        push({ kind: 'info', title: 'Session removed', body: 'Your teacher removed this session, so you are back in your lobby.' });
        router.replace('/student');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not open this exam');
    }
  }, [code, push, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // realtime
  useEffect(() => {
    pendingHiddenReport.current = false;
    // Socket.io rooms do not survive a reconnect: a device that drops off long
    // enough to get a new connection must join the exam room again, or it
    // silently stops receiving pushes, locks and leaderboard updates.
    const join = () => {
      socket.emit('join:exam', { examCode: code, role: 'student' });
      if (pendingHiddenReport.current) {
        socket.emit('student:tab-hidden', { examCode: code });
        pendingHiddenReport.current = false;
      }
    };
    if (socket.connected) join();
    socket.on('connect', join);

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      if (socket.connected) {
        socket.emit('student:tab-hidden', { examCode: code });
      } else {
        pendingHiddenReport.current = true;
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onState = (payload: ExamPublic) => {
      if (payload.code !== code) return;
      setExam(payload);
    };
    const onPushed = (payload: { examId: string; active: NonNullable<ExamPublic['active']> }) => {
      // A live push always closes any open self-paced set on the server; mirror
      // that at once so the page does not flash the set before `exam:state` lands.
      setExam((prev) =>
        prev
          ? {
              ...prev,
              status: 'live',
              active: payload.active,
              set: prev.set && !prev.set.closed ? { ...prev.set, closed: true, openQuestionId: null } : prev.set
            }
          : prev
      );
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
    // Faculty deleted the session: nothing is left to show here.
    const onRemoved = () => {
      push({ kind: 'info', title: 'Session removed', body: 'Your teacher removed this session, so you are back in your lobby.' });
      router.replace('/student');
    };
    const onBoard = (payload: { entries: LeaderboardEntry[] }) => setBoard(payload.entries);
    // A short/long answer scored by the AI (or a teacher) after the question closed.
    const onAnswerGraded = (payload: { examId: string; questionId: string; grade: Grade; awarded: number }) => {
      setExam((prev) => {
        if (!prev || prev.id !== payload.examId) return prev;
        const mine = prev.myAnswers[payload.questionId];
        if (!mine) return prev;
        return {
          ...prev,
          myAnswers: { ...prev.myAnswers, [payload.questionId]: { ...mine, grade: payload.grade, awarded: payload.awarded } }
        };
      });
    };

    socket.on('exam:state', onState);
    socket.on('question:pushed', onPushed);
    socket.on('question:locked', onLocked);
    socket.on('exam:ended', onEnded);
    socket.on('exam:removed', onRemoved);
    socket.on('leaderboard:update', onBoard);
    socket.on('answer:graded', onAnswerGraded);
    return () => {
      socket.off('connect', join);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      socket.off('exam:state', onState);
      socket.off('question:pushed', onPushed);
      socket.off('question:locked', onLocked);
      socket.off('exam:ended', onEnded);
      socket.off('exam:removed', onRemoved);
      socket.off('leaderboard:update', onBoard);
      socket.off('answer:graded', onAnswerGraded);
    };
  }, [socket, code, load, push, router]);

  const active = exam?.active ?? null;
  const liveExam = exam?.status === 'live';

  // Announce set changes once: a new batch of questions, or the set closing.
  const lastSet = useRef<{ id: string; closed: boolean } | null>(null);
  const setId = exam?.set?.id ?? null;
  const setClosed = exam?.set?.closed ?? false;
  const setSize = exam?.set?.items.length ?? 0;
  useEffect(() => {
    if (!setId) return;
    const previous = lastSet.current;
    lastSet.current = { id: setId, closed: setClosed };
    if (!previous) return; // first load — nothing changed yet
    if (previous.id !== setId && !setClosed) {
      push({
        kind: 'info',
        title: `${setSize} question${setSize === 1 ? '' : 's'} pushed`,
        body: 'Pick any question to start — each one has its own timer.'
      });
    } else if (previous.id === setId && !previous.closed && setClosed) {
      push({ kind: 'info', title: 'The question set has closed', body: 'Your results for it are now visible.' });
    }
  }, [setId, setClosed, setSize, push]);
  const question: StudentQuestion | null = active?.question ?? null;
  const remaining = active ? Math.max(0, active.endsAt - now) : 0;
  const totalMs = active ? active.endsAt - active.pushedAt : 0;
  const secondsLeft = Math.ceil(remaining / 1000);
  const urgent = !!active && !active.locked && remaining <= 10_000;
  const myAnswer = active ? exam?.myAnswers[active.questionId] : undefined;
  const answered = !!myAnswer;
  const expired = !!active && (active.locked || remaining <= 0);
  /** This answer is sitting in the device's outbox, waiting for the network. */
  const queued = useMemo(
    () =>
      exam && active
        ? outbox.pending.find((row) => row.examId === exam.id && row.questionId === active.questionId) ?? null
        : null,
    [outbox.pending, exam, active]
  );
  /** Already committed, one way or another — the inputs must stay locked. */
  const committed = answered || !!queued;

  // A reconnect is the moment to both drain the outbox and re-read the room:
  // questions may have been pushed and locked while this device was dark.
  useEffect(() => {
    const onConnect = () => {
      void load();
      void flushOutbox('socket-reconnect');
    };
    socket.on('connect', onConnect);
    window.addEventListener('online', onConnect);
    return () => {
      socket.off('connect', onConnect);
      window.removeEventListener('online', onConnect);
    };
  }, [socket, load]);

  // Report what the outbox managed to deliver (or failed to) while the student
  // was looking at a later question.
  useEffect(() => {
    return onSyncOutcome((outcome) => {
      if (outcome.status === 'synced') {
        if (outcome.receipt.exam.id === exam?.id) {
          setExam(outcome.receipt.exam);
          setBoard(outcome.receipt.leaderboard);
        }
        push({
          kind: 'success',
          title: `Question ${outcome.record.questionIndex} delivered`,
          body: 'The answer saved on this device reached the server and has been recorded.'
        });
        return;
      }
      if (outcome.status === 'duplicate') {
        void load();
        return;
      }
      push({
        kind: 'error',
        title: `Question ${outcome.record.questionIndex} could not be delivered`,
        body: outcome.message
      });
      void load();
    });
  }, [exam?.id, load, push]);

  // reset draft when a new question arrives
  useEffect(() => {
    if (question && lastQuestion.current !== question.id) {
      lastQuestion.current = question.id;
      setDraft('');
      warned.current = null;
    }
  }, [question]);

  // Restore whatever was typed before a reload or a crash. Runs after the reset
  // above, so a recovered draft wins over the blank slate.
  useEffect(() => {
    const studentId = user?.id;
    const examId = exam?.id;
    const questionId = question?.id;
    if (!studentId || !examId || !questionId) return;
    let cancelled = false;
    void readAnswerDraft(studentId, examId, questionId).then((saved) => {
      if (cancelled || !saved) return;
      setDraft((current) => (current.length > 0 ? current : saved));
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, exam?.id, question?.id]);

  // Persist the draft as it is typed, debounced so storage is not hammered on
  // every keystroke of a long answer.
  useEffect(() => {
    const studentId = user?.id;
    const examId = exam?.id;
    const questionId = question?.id;
    if (!studentId || !examId || !questionId || committed || !draft) return;
    const timer = window.setTimeout(() => {
      void saveAnswerDraft({ studentId, examId, questionId, answer: draft });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, user?.id, exam?.id, question?.id, committed]);

  // 10-second warning
  useEffect(() => {
    if (!active || committed || active.locked) return;
    if (secondsLeft <= 10 && secondsLeft > 0 && warned.current !== active.questionId) {
      warned.current = active.questionId;
      push({ kind: 'warn', title: '10 seconds left', body: 'Submit your answer now.' });
    }
  }, [secondsLeft, active, committed, push]);

  const canSubmit = useMemo(() => {
    if (!question || committed || expired) return false;
    if (question.type === 'mcq' || question.type === 'truefalse' || question.type === 'fill') return draft.trim().length > 0;
    return draft.trim().length > 1;
  }, [question, committed, expired, draft]);

  async function submit() {
    if (!exam || !question || !active || !canSubmit || !user) return;
    const value = question.type === 'mcq' || question.type === 'truefalse' ? draft : draft.trim();
    // Stamped from the server-synced clock, not `Date.now()`, so an answer the
    // outbox replays later is still timed by when the student committed it.
    const committedAt = now;
    setSubmitting(true);
    try {
      const res = await api<AnswerReceipt>('/student/answers', {
        method: 'POST',
        body: { examId: exam.id, questionId: question.id, answer: value }
      });
      setExam(res.exam);
      setBoard(res.leaderboard);
      void clearAnswerDraft(user.id, exam.id, question.id);
      push({
        kind: 'success',
        title: 'Answer locked in',
        body: `Recorded in ${(res.response.latencyMs / 1000).toFixed(1)}s. Result unlocks when the question closes.`
      });
    } catch (err) {
      // The request never reached the server (no network, or the server is
      // momentarily unreachable) — hand the answer to the outbox instead of
      // losing it, and let the student carry on.
      if (isTransportFailure(err)) {
        await enqueueAnswer({
          studentId: user.id,
          examId: exam.id,
          examCode: exam.code,
          questionId: question.id,
          questionIndex: active.index,
          prompt: question.prompt,
          answer: value,
          clientSubmittedAt: committedAt,
          pushedAt: active.pushedAt,
          endsAt: active.endsAt
        });
        push({
          kind: 'warn',
          title: 'Saved on this device',
          body: 'No connection right now. Your answer is stored locally and will be submitted automatically as soon as you are back online.'
        });
      } else {
        const message = err instanceof ApiError ? err.message : 'Could not submit';
        push({ kind: 'error', title: 'Submission rejected', body: message });
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const progressPct = active ? Math.round((active.index / active.total) * 100) : 0;

  /* ── states ─────────────────────────────────────────────── */

  if (error) {
    const offline = !outbox.online;
    return (
      <StudentShell>
        <Panel className="mx-auto max-w-md p-8 text-center sm:p-10">
          <span
            className={cx(
              'mx-auto grid h-14 w-14 place-items-center rounded-2xl ring-1 ring-inset',
              offline ? 'bg-amber-400/10 text-amber-200 ring-amber-400/30' : 'bg-ember-500/10 text-ember-300 ring-ember-500/30'
            )}
          >
            {offline ? <WifiOff className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
          </span>
          <h1 className="mt-5 font-display text-[24px] font-medium text-white">
            {offline ? 'No connection' : 'This exam is not accessible'}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-white/60">
            {offline
              ? 'This device is offline, so the exam room could not be opened. It will load by itself the moment you are back online.'
              : error}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="md" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
            <LinkButton href="/student" variant="gold" size="md">
              Back to lobby
            </LinkButton>
          </div>
          {outbox.pending.length > 0 && <OfflineQueuePanel outbox={outbox} className="mt-5 text-left" />}
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
            <Link href="/student" className="inline-flex items-center gap-1.5 text-[13px] text-white/55 hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> Lobby
            </Link>
            <Badge tone="neutral">session ended</Badge>
          </div>

          <OfflineQueuePanel outbox={outbox} />

          <Panel className="gold-edge relative overflow-hidden p-7 text-center sm:p-10">
            <div className="aura aura-gold left-1/2 top-[-6rem] h-64 w-64 -translate-x-1/2" />
            <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-b from-gold-300/25 to-gold-500/10 text-gold-200 ring-1 ring-inset ring-gold-300/35 shadow-gold">
              <Trophy className="h-7 w-7" />
            </span>
            <p className="eyebrow relative mt-6">{exam.subject}</p>
            <h1 className="relative mt-2 font-display text-[2rem] font-normal leading-tight text-white sm:text-[2.3rem]">
              {exam.title}
            </h1>
            <p className="relative mt-2 text-[14px] text-white/60">Session {exam.code} has closed.</p>

            <div className="relative mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { k: 'points', v: points },
                { k: 'answered', v: `${mine.length}/${exam.totalQuestions}` },
                { k: 'correct', v: correct },
                { k: 'rank', v: me ? `#${me.rank}` : '—' }
              ].map((s) => (
                <div key={s.k} className="rounded-2xl border border-white/[0.08] bg-ink-950/40 p-4">
                  <p className="num font-display text-[28px] font-medium leading-none text-white">{s.v}</p>
                  <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-white/55">{s.k}</p>
                </div>
              ))}
            </div>

            {pending > 0 && (
              <p className="relative mt-5 text-[13px] text-amber-200/85">
                {pending} written answer{pending > 1 ? 's are' : ' is'} still being reviewed — your score updates automatically.
              </p>
            )}

            <div className="relative mt-7 flex flex-wrap justify-center gap-2">
              <LinkButton href="/student" variant="gold" size="md">
                Back to lobby
              </LinkButton>
              <LinkButton href="/student" variant="ghost" size="md">
                <Sparkles className="h-4 w-4" /> Join another session
              </LinkButton>
            </div>
          </Panel>

          {exam.review && (
            <Panel className="p-5 sm:p-6">
              <SectionHead
                eyebrow="Review"
                title="Your answers"
                sub={
                  exam.review.some((row) => row.correctAnswer !== undefined)
                    ? 'Your teacher has shared the answer key — compare and learn from each question.'
                    : 'Every question you met in this session, with your answer and result.'
                }
              />
              <div className="mt-5">
                <ReviewList items={exam.review} />
              </div>
            </Panel>
          )}

          {exam.showLeaderboard && (
            <Panel className="p-5 sm:p-6">
              <SectionHead eyebrow="Cohort" title="Final leaderboard" />
              <div className="mt-4">
                <Leaderboard entries={board} highlightId={user?.id} max={10} />
              </div>
            </Panel>
          )}
        </div>
      </StudentShell>
    );
  }

  /* ── self-paced set ─────────────────────────────────────── */
  if (exam.set && !exam.set.closed && user) {
    return (
      <StudentShell maxWidth="max-w-6xl">
        <SetRunner
          exam={exam}
          set={exam.set}
          board={board}
          now={now}
          synced={synced}
          outbox={outbox}
          userId={user.id}
          onExam={setExam}
          onBoard={setBoard}
          reload={load}
        />
      </StudentShell>
    );
  }

  /* ── waiting room ───────────────────────────────────────── */
  if (!active) {
    const closedSet = exam.set && exam.set.closed ? exam.set : null;
    return (
      <StudentShell maxWidth="max-w-4xl">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/student"
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-[13px] text-white/60 transition hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Leave room
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11.5px] uppercase tracking-[0.12em] text-white/60">
              {outbox.online ? (
                <>
                  <Wifi className="h-3 w-3 text-mint-400" /> connected · {synced ? 'clock synced' : 'syncing'}
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 text-ember-400" /> offline · answers saved locally
                </>
              )}
            </span>
          </div>

          <OfflineQueuePanel outbox={outbox} />

          <Panel className="gold-edge relative overflow-hidden p-8 text-center sm:p-14">
            <div className="absolute inset-0 dot-veil opacity-30" />
            <div className="relative mx-auto grid h-20 w-20 animate-pulseRing place-items-center rounded-full bg-gold-400/10 text-gold-200 ring-1 ring-inset ring-gold-300/35">
              <Hourglass className="h-8 w-8" />
            </div>
            <h1 className="relative mt-7 font-display text-[2rem] font-normal leading-tight text-white sm:text-[2.4rem]">
              You are in the <span className="gold-text italic">room.</span>
            </h1>
            <p className="relative mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-white/65">
              {exam.title} · {exam.totalQuestions} questions. Keep this tab open — the question appears here the moment
              your faculty pushes it.
            </p>
            {liveExam && (
              <p className="relative mx-auto mt-4 flex w-fit max-w-full items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-1.5 text-[12.5px] leading-snug text-amber-100/85">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                Leaving this tab during the live session is reported to faculty.
              </p>
            )}
            <div className="relative mx-auto mt-7 flex max-w-sm items-center justify-between rounded-2xl border border-gold-200/15 bg-ink-950/50 px-5 py-3.5">
              <span className="text-[12px] uppercase tracking-[0.14em] text-white/55">room code</span>
              <span className="font-mono text-[17px] tracking-[0.3em] text-gold-200">{exam.code}</span>
            </div>
            <div className="relative mt-5 flex items-center justify-center gap-2 text-[13px] text-white/55">
              <Radio className="h-3.5 w-3.5 animate-pulse text-gold-300" />
              {closedSet ? 'listening for the next push…' : 'listening for the first push…'}
            </div>
          </Panel>

          {closedSet && (
            <Panel className="p-5 sm:p-6">
              <SectionHead
                eyebrow="Set results"
                title="Your last question set"
                sub="The set is closed — here is how each question went."
                action={
                  <Badge tone="royal">
                    <Layers className="h-3 w-3" /> {closedSet.items.length} questions
                  </Badge>
                }
              />
              <ol className="mt-5 space-y-2">
                {closedSet.items.map((item) => {
                  const mine = exam.myAnswers[item.questionId];
                  return (
                    <li
                      key={item.questionId}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 sm:flex-nowrap"
                    >
                      <span className="num grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] font-display text-[15px] text-white/80">
                        {item.index}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-[14px] text-white/85">
                          {item.prompt ?? `${typeLabel(item.type)} · ${item.points} pts`}
                        </p>
                        <p className="mt-0.5 truncate text-[12.5px] text-white/50">
                          {mine
                            ? `Your answer: ${describeAnswer(item.type, item.question?.options ?? [], mine.answer)}`
                            : item.state === 'expired'
                              ? 'Time ran out'
                              : item.state === 'skipped'
                                ? 'Skipped'
                                : item.state === 'open'
                                  ? 'The set closed before you submitted'
                                  : 'Not attempted'}
                        </p>
                      </div>
                      {mine ? (
                        mine.grade === 'pending' ? (
                          <Badge tone="neutral">
                            <Hourglass className="h-3 w-3" /> in review
                          </Badge>
                        ) : mine.grade === 'correct' ? (
                          <Badge tone="mint">
                            <CheckCircle2 className="h-3 w-3" /> +{mine.awarded} pts
                          </Badge>
                        ) : (
                          <Badge tone="ember">
                            <XCircle className="h-3 w-3" /> incorrect
                          </Badge>
                        )
                      ) : (
                        <Badge tone="neutral">no answer</Badge>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Panel>
          )}

          {exam.showLeaderboard && (
            <Panel className="p-5 sm:p-6">
              <SectionHead eyebrow="Leaderboard" title="Cohort standings" sub="Ranked by accuracy, then speed." />
              <div className="mt-4">
                <Leaderboard entries={board} highlightId={user?.id} max={8} />
              </div>
            </Panel>
          )}
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
          <div className="flex min-w-0 items-center gap-2.5">
            <Badge tone="gold" dot>live</Badge>
            <span className="truncate text-[13.5px] text-white/70">
              {exam.title} · <span className="font-mono text-white/55">{exam.code}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="num text-[13px] text-white/60">
              Question {active.index} of {active.total}
            </span>
            <div
              className="h-1.5 w-28 overflow-hidden rounded-full bg-white/[0.08]"
              role="progressbar"
              aria-label="Paper progress"
              aria-valuemin={0}
              aria-valuemax={active.total}
              aria-valuenow={active.index}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-royal-400 to-gold-300 transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        <OfflineQueuePanel outbox={outbox} />
        {liveExam && (
          <p className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-1.5 text-[12.5px] leading-snug text-amber-100/85">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            For exam integrity, leaving this tab during the live session is reported to faculty.
          </p>
        )}
        {!expired && (
          <MobileTimerBar
            remaining={remaining}
            total={totalMs}
            urgent={urgent}
            label={committed ? 'Answer in · question closes in' : `Question ${active.index} of ${active.total}`}
          />
        )}

        <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr] [&>*]:min-w-0">
          {/* question column */}
          <div className="space-y-4">
            <Panel
              className={cx(
                'relative overflow-hidden transition',
                urgent && 'ring-1 ring-ember-500/40',
                expired && 'opacity-95'
              )}
            >
              {/* timer bar — same colour logic as the countdown ring */}
              <div className="relative h-1.5 w-full bg-white/[0.06]">
                <div
                  className={cx(
                    'h-full transition-[width] duration-300 ease-linear',
                    urgent
                      ? 'bg-gradient-to-r from-ember-500 to-amber-400'
                      : totalMs && remaining / totalMs > 0.4
                        ? 'bg-gradient-to-r from-mint-500 to-mint-300'
                        : 'bg-gradient-to-r from-amber-500 to-amber-300'
                  )}
                  style={{ width: `${totalMs ? Math.max(0, Math.min(100, (remaining / totalMs) * 100)) : 0}%` }}
                />
              </div>

              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4 sm:px-7">
                <div className="flex flex-wrap items-center gap-2">
                  <TypePill type={question!.type} />
                  <span className="text-[13px] text-white/60">{typeLabel(question!.type)}</span>
                  <span className="num text-[13px] text-white/50">· {question!.points} pts</span>
                </div>
                {/* Phones read the time from the pinned bar above. */}
                <div className="hidden items-center gap-2 lg:flex">
                  <span
                    className={cx(
                      'num text-[17px] font-semibold',
                      urgent ? 'text-ember-300' : 'text-white'
                    )}
                  >
                    {expired ? '0:00' : fmtClock(remaining)}
                  </span>
                  <Timer className={cx('h-4 w-4', urgent ? 'text-ember-300' : 'text-white/45')} />
                  {synced && <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">server</span>}
                </div>
              </div>

              <div className="p-5 sm:p-7">
                <div className="flex items-start gap-3.5">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-400/[0.1] font-display text-[16px] font-medium text-gold-200 ring-1 ring-inset ring-gold-300/25">
                    {active.index}
                  </span>
                  <h2 className="font-display text-[19px] font-normal leading-[1.5] text-white sm:text-[22px]">
                    {question!.prompt}
                  </h2>
                </div>

                {/* answer inputs */}
                <div className="mt-6">
                  <AnswerInput
                    question={question!}
                    draft={draft}
                    onDraft={setDraft}
                    disabled={committed || expired}
                    onSubmitShortcut={() => void submit()}
                  />
                  {!committed && !expired && <ShortcutHint type={question!.type} />}
                </div>
                {/* action */}
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                  {answered ? (
                    <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-mint-400/25 bg-mint-500/[0.08] px-3.5 py-3">
                      <CircleCheck className="h-4 w-4 shrink-0 text-mint-300" />
                      <p className="text-[13.5px] text-mint-100">
                        Answer recorded. Result unlocks when the question closes.
                      </p>
                    </div>
                  ) : queued ? (
                    <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.08] px-3.5 py-3">
                      {outbox.syncing ? (
                        <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-amber-300" />
                      ) : (
                        <CloudUpload className="h-4 w-4 shrink-0 text-amber-300" />
                      )}
                      <p className="text-[13.5px] text-amber-100">
                        Saved on this device with {fmtClock(Math.max(0, queued.endsAt - queued.clientSubmittedAt))} on
                        the clock.
                        {outbox.syncing ? ' Delivering now…' : ' It will be submitted the moment you reconnect.'}
                      </p>
                    </div>
                  ) : expired ? (
                    <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-ember-500/30 bg-ember-500/[0.08] px-4 py-3">
                      <Lock className="h-4 w-4 shrink-0 text-ember-300" />
                      <p className="text-[13.5px] text-ember-200">
                        Time is up for this question. Wait for the next push.
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="max-w-sm text-[12.5px] leading-relaxed text-white/55">
                        {outbox.online
                          ? 'One submission per question · graded automatically for objective answers'
                          : 'Offline — your answer is saved on this device and sent automatically'}
                      </p>
                      <Button
                        variant="gold"
                        size="lg"
                        onClick={submit}
                        loading={submitting}
                        disabled={!canSubmit}
                        className="w-full px-7 sm:w-auto"
                      >
                        {outbox.online ? <Send className="h-4 w-4" /> : <CloudUpload className="h-4 w-4" />}
                        {outbox.online ? 'Submit answer' : 'Save answer'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Panel>

            {answered && myAnswer && (
              <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-[11.5px] uppercase tracking-[0.14em] text-white/45">your submission</p>
                  <p className="mt-1 max-h-16 overflow-hidden text-[13.5px] leading-relaxed text-white/80">
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

            {!answered && queued && (
              <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-[11.5px] uppercase tracking-[0.14em] text-white/45">held on this device</p>
                  <p className="mt-1 max-h-16 overflow-hidden text-[13.5px] leading-relaxed text-white/80">
                    {isObjective
                      ? `Option ${String.fromCharCode(65 + Number(queued.answer))} — ${question!.options[Number(queued.answer)] ?? ''}`
                      : queued.answer}
                  </p>
                </div>
                <Badge tone="amber">
                  <CloudUpload className="h-3 w-3" /> pending sync
                </Badge>
              </Panel>
            )}
          </div>

          {/* side column */}
          <div className="space-y-4">
            <Panel className="hidden p-6 lg:block">
              <div className="flex flex-col items-center">
                <RadialTimer remaining={expired ? 0 : remaining} total={totalMs} size={172} urgent={urgent} />
                <p className="mt-3 flex items-center gap-1.5 text-[11.5px] uppercase tracking-[0.16em] text-white/55">
                  <Zap className="h-3 w-3 text-gold-300" /> synced to server clock
                </p>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-white/[0.08] bg-ink-950/40 p-3 text-center">
                  <p className="num font-display text-[20px] font-medium text-white">{question!.points}</p>
                  <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.12em] text-white/55">points</p>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-ink-950/40 p-3 text-center">
                  <p className="num font-display text-[20px] font-medium text-white">{Math.round(totalMs / 1000)}s</p>
                  <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.12em] text-white/55">allowance</p>
                </div>
              </div>
            </Panel>

            {exam.showLeaderboard && (
              <Panel className="p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="eyebrow">Live rank</p>
                    <h3 className="mt-1.5 font-display text-[20px] font-medium text-white">Cohort standings</h3>
                  </div>
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold-400/[0.1] text-gold-200 ring-1 ring-inset ring-gold-300/25">
                    <Trophy className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-4">
                  <Leaderboard entries={board} highlightId={user?.id} max={8} compact />
                </div>
              </Panel>
            )}

            <Panel className="p-4">
              {outbox.online ? (
                <p className="flex items-center gap-2.5 text-[13px] leading-relaxed text-white/60">
                  <Wifi className="h-4 w-4 shrink-0 text-mint-400" />
                  Keep this tab in focus. Submissions close automatically when the timer ends.
                </p>
              ) : (
                <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-amber-200/85">
                  <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
                  You are disconnected. Answer anyway — it is saved on this device and delivered automatically when the
                  network returns.
                </p>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
