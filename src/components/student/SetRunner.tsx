'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CircleCheck,
  CloudUpload,
  Eye,
  Hourglass,
  Layers,
  ListChecks,
  Lock,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  SkipForward,
  Timer,
  Trophy,
  XCircle,
  Zap
} from 'lucide-react';
import type { ExamPublic, LeaderboardEntry, StudentSetItem, StudentSetView } from '@shared/types';
import { RadialTimer } from '@/components/charts/Charts';
import { Leaderboard } from '@/components/Leaderboard';
import { OfflineQueuePanel } from '@/components/OfflineQueuePanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TypePill, typeLabel } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { AnswerInput, ShortcutHint } from './AnswerInput';
import { MobileTimerBar } from './MobileTimerBar';
import { api, ApiError, cx } from '@/lib/api';
import {
  clearAnswerDraft,
  enqueueAnswer,
  isTransportFailure,
  readAnswerDraft,
  saveAnswerDraft,
  type AnswerReceipt,
  type OutboxSnapshot
} from '@/lib/offlineQueue';
import { fmtClock, fmtDuration } from '@/lib/time';

type Outcome = 'answered' | 'saved' | 'skipped' | 'expired';
type DisplayState = StudentSetItem['state'] | 'saved';

const AUTO_ADVANCE_SECONDS = 5;

const STATE_META: Record<DisplayState, { label: string; tile: string; chip: string }> = {
  available: {
    label: 'Not started',
    tile: 'border-white/15 bg-white/[0.03] text-white/80 hover:border-gold-200/50 hover:text-white',
    chip: 'bg-white/[0.06] text-white/70 ring-white/10'
  },
  open: {
    label: 'In progress',
    tile: 'border-royal-400/70 bg-royal-500/25 text-white shadow-[0_0_0_3px_rgba(98,121,245,0.18)]',
    chip: 'bg-royal-500/[0.16] text-royal-100 ring-royal-400/35'
  },
  answered: {
    label: 'Answered',
    tile: 'border-mint-400/40 bg-mint-500/[0.16] text-mint-200',
    chip: 'bg-mint-500/[0.14] text-mint-300 ring-mint-400/30'
  },
  saved: {
    label: 'Saved on device',
    tile: 'border-amber-400/45 bg-amber-400/[0.14] text-amber-200',
    chip: 'bg-amber-400/[0.13] text-amber-200 ring-amber-400/30'
  },
  expired: {
    label: 'Time ran out',
    tile: 'border-ember-500/40 bg-ember-500/[0.12] text-ember-300',
    chip: 'bg-ember-500/[0.13] text-ember-300 ring-ember-500/30'
  },
  skipped: {
    label: 'Skipped',
    tile: 'border-ember-500/30 bg-ember-500/[0.08] text-ember-300/90',
    chip: 'bg-ember-500/[0.1] text-ember-300 ring-ember-500/25'
  },
  closed: {
    label: 'Closed',
    tile: 'border-white/10 bg-white/[0.02] text-white/35',
    chip: 'bg-white/[0.05] text-white/50 ring-white/10'
  }
};

function nextAvailable(items: StudentSetItem[], afterIndex: number, isFree: (item: StudentSetItem) => boolean) {
  const free = items.filter(isFree);
  return free.find((item) => item.index > afterIndex) ?? free[0] ?? null;
}

/**
 * The student side of a self-paced set: every pushed question is listed, the
 * student picks one, and only that question's timer runs. Submitting (or
 * running out of time) offers the next open question automatically.
 */
export function SetRunner({
  exam,
  set,
  board,
  now,
  synced,
  outbox,
  userId,
  onExam,
  onBoard,
  reload
}: {
  exam: ExamPublic;
  set: StudentSetView;
  board: LeaderboardEntry[];
  now: number;
  synced: boolean;
  outbox: OutboxSnapshot;
  userId: string;
  onExam: (exam: ExamPublic) => void;
  onBoard: (entries: LeaderboardEntry[]) => void;
  reload: () => Promise<void>;
}) {
  const { push } = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'open' | 'submit' | 'skip' | null>(null);
  const [confirm, setConfirm] = useState<StudentSetItem | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [finished, setFinished] = useState<{ questionId: string; outcome: Outcome } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [skipConfirmStart, setSkipConfirmStart] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const warned = useRef<string | null>(null);
  const lastOpen = useRef<string | null>(null);
  /** Remembers which finished question already triggered its auto-advance. */
  const autoFired = useRef<string | null>(null);

  const queuedIds = useMemo(
    () => new Set(outbox.pending.filter((row) => row.examId === exam.id).map((row) => row.questionId)),
    [outbox.pending, exam.id]
  );

  const displayState = useCallback(
    (item: StudentSetItem): DisplayState => {
      if (queuedIds.has(item.questionId) && item.state !== 'answered') return 'saved';
      if (item.state === 'open' && item.deadline && now > item.deadline) return 'expired';
      return item.state;
    },
    [queuedIds, now]
  );
  const isFree = useCallback((item: StudentSetItem) => displayState(item) === 'available', [displayState]);

  const openItem = set.items.find((item) => item.questionId === set.openQuestionId) ?? null;
  const openState = openItem ? displayState(openItem) : null;
  const running = openItem && openState === 'open' ? openItem : null;
  const remaining = running?.deadline ? Math.max(0, running.deadline - now) : 0;
  const allowance = running ? running.timerSeconds * 1000 : 0;
  const urgent = !!running && remaining <= 10_000;

  const counts = set.items.reduce(
    (acc, item) => {
      const state = displayState(item);
      if (state === 'answered' || state === 'saved') acc.done++;
      else if (state === 'expired' || state === 'skipped') acc.missed++;
      else if (state === 'available') acc.left++;
      return acc;
    },
    { done: 0, missed: 0, left: 0 }
  );
  const progressPct = set.items.length ? Math.round(((counts.done + counts.missed) / set.items.length) * 100) : 0;
  const finishedItem = finished ? set.items.find((item) => item.questionId === finished.questionId) ?? null : null;
  const upNext = nextAvailable(set.items, finishedItem?.index ?? 0, isFree);

  // A different question opened: start from a blank (or recovered) draft.
  useEffect(() => {
    const id = running?.questionId ?? null;
    if (id === lastOpen.current) return;
    lastOpen.current = id;
    setDraft('');
    warned.current = null;
    if (!id) return;
    setFinished(null);
    setCountdown(null);
    let cancelled = false;
    void readAnswerDraft(userId, exam.id, id).then((saved) => {
      if (!cancelled && saved) setDraft((current) => (current.length > 0 ? current : saved));
    });
    return () => {
      cancelled = true;
    };
  }, [running?.questionId, userId, exam.id]);

  // Typed answers survive a reload or a crash.
  useEffect(() => {
    if (!running || !draft) return;
    const timer = window.setTimeout(() => {
      void saveAnswerDraft({ studentId: userId, examId: exam.id, questionId: running.questionId, answer: draft });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, running, userId, exam.id]);

  // Ten-second warning, once per question (with a buzz on phones).
  useEffect(() => {
    if (!running) return;
    const secondsLeft = Math.ceil(remaining / 1000);
    if (secondsLeft <= 10 && secondsLeft > 0 && warned.current !== running.questionId) {
      warned.current = running.questionId;
      push({ kind: 'warn', title: '10 seconds left', body: `Question ${running.index} — submit now.` });
      // A short buzz on phones that support it; a no-op everywhere else.
      if (typeof window !== 'undefined' && typeof window.navigator.vibrate === 'function') window.navigator.vibrate(180);
    }
  }, [remaining, running, push]);

  // The timer ran out on the open question before it was submitted.
  useEffect(() => {
    if (openItem && openState === 'expired' && !finished) {
      setFinished({ questionId: openItem.questionId, outcome: 'expired' });
      void clearAnswerDraft(userId, exam.id, openItem.questionId);
    }
  }, [openItem, openState, finished, userId, exam.id]);

  const open = useCallback(
    async (item: StudentSetItem) => {
      if (!outbox.online) {
        push({ kind: 'warn', title: 'You are offline', body: 'Starting a question needs a connection, so its timer is recorded fairly.' });
        return;
      }
      setBusy('open');
      setOpeningId(item.questionId);
      setConfirm(null);
      setCountdown(null);
      try {
        const res = await api<{ exam: ExamPublic }>('/student/sets/open', {
          method: 'POST',
          body: { examId: exam.id, questionId: item.questionId }
        });
        onExam(res.exam);
        setFinished(null);
      } catch (err) {
        push({ kind: 'error', title: 'Could not start the question', body: err instanceof ApiError ? err.message : 'Try again' });
        await reload();
      } finally {
        setBusy(null);
        setOpeningId(null);
      }
    },
    [exam.id, onExam, outbox.online, push, reload]
  );

  // Auto-advance: count down, then open the next free question.
  useEffect(() => {
    if (!finished || !set.autoAdvance || !upNext || !outbox.online || set.closed) {
      setCountdown(null);
      return;
    }
    setCountdown(AUTO_ADVANCE_SECONDS);
    const started = Date.now();
    const tick = window.setInterval(() => {
      const left = AUTO_ADVANCE_SECONDS - Math.floor((Date.now() - started) / 1000);
      setCountdown(Math.max(0, left));
    }, 250);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished?.questionId, finished?.outcome, set.autoAdvance, upNext?.questionId, outbox.online, set.closed]);

  // Fire once per finished question, and never while another one is running —
  // the countdown can still read 0 for a render after the next one opened.
  useEffect(() => {
    if (countdown !== 0 || !finished || running || !upNext || busy !== null) return;
    const key = `${finished.questionId}:${finished.outcome}`;
    if (autoFired.current === key) return;
    autoFired.current = key;
    void open(upNext);
  }, [countdown, finished, running, upNext, busy, open]);

  const canSubmit = !!running && !busy && (running.type === 'mcq' || running.type === 'truefalse' || running.type === 'fill'
    ? draft.trim().length > 0
    : draft.trim().length > 1);

  async function submit() {
    if (!running || !canSubmit || !running.question) return;
    const question = running.question;
    const value = question.type === 'mcq' || question.type === 'truefalse' ? draft : draft.trim();
    const committedAt = now;
    setBusy('submit');
    try {
      const res = await api<AnswerReceipt>('/student/answers', {
        method: 'POST',
        body: { examId: exam.id, questionId: running.questionId, answer: value }
      });
      onExam(res.exam);
      onBoard(res.leaderboard);
      void clearAnswerDraft(userId, exam.id, running.questionId);
      setFinished({ questionId: running.questionId, outcome: 'answered' });
      push({
        kind: 'success',
        title: 'Answer locked in',
        body: `Question ${running.index} recorded in ${(res.response.latencyMs / 1000).toFixed(1)}s.`
      });
    } catch (err) {
      if (isTransportFailure(err)) {
        await enqueueAnswer({
          studentId: userId,
          examId: exam.id,
          examCode: exam.code,
          questionId: running.questionId,
          questionIndex: running.index,
          prompt: question.prompt,
          answer: value,
          clientSubmittedAt: committedAt,
          pushedAt: running.openedAt ?? committedAt,
          endsAt: running.deadline ?? committedAt
        });
        setFinished({ questionId: running.questionId, outcome: 'saved' });
        push({
          kind: 'warn',
          title: 'Saved on this device',
          body: 'No connection right now. It will be submitted automatically as soon as you are back online.'
        });
      } else {
        push({ kind: 'error', title: 'Submission rejected', body: err instanceof ApiError ? err.message : 'Could not submit' });
        await reload();
      }
    } finally {
      setBusy(null);
    }
  }

  async function skip() {
    if (!running) return;
    setBusy('skip');
    setConfirmSkip(false);
    try {
      const res = await api<{ exam: ExamPublic }>('/student/sets/skip', {
        method: 'POST',
        body: { examId: exam.id, questionId: running.questionId }
      });
      void clearAnswerDraft(userId, exam.id, running.questionId);
      setFinished({ questionId: running.questionId, outcome: 'skipped' });
      onExam(res.exam);
    } catch (err) {
      push({ kind: 'error', title: 'Could not skip', body: err instanceof ApiError ? err.message : 'Try again' });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  function requestStart(item: StudentSetItem) {
    if (running) {
      push({ kind: 'info', title: `Finish question ${running.index} first`, body: 'Its timer is still running.' });
      return;
    }
    if (displayState(item) !== 'available') return;
    if (skipConfirmStart) void open(item);
    else setConfirm(item);
  }

  /* ── pieces ─────────────────────────────────────────────── */

  const navigatorPanel = (
    <Panel className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Your paper</p>
          <h3 className="mt-1.5 font-display text-[20px] font-medium text-white">Question navigator</h3>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold-400/[0.1] text-gold-200 ring-1 ring-inset ring-gold-300/25">
          <ListChecks className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-2">
        {set.items.map((item) => {
          const state = displayState(item);
          return (
            <button
              key={item.questionId}
              type="button"
              onClick={() => requestStart(item)}
              disabled={state !== 'available' || !!running}
              aria-label={`Question ${item.index}: ${STATE_META[state].label}`}
              title={`Question ${item.index} · ${STATE_META[state].label}`}
              className={cx(
                'focus-ring num relative grid aspect-square place-items-center rounded-xl border font-display text-[16px] font-medium transition disabled:cursor-default',
                STATE_META[state].tile,
                state === 'open' && 'animate-pulse'
              )}
            >
              {item.index}
              {state === 'answered' && <CheckCircle2 className="absolute right-1 top-1 h-3 w-3" />}
            </button>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] text-white/55">
        {(['available', 'open', 'answered', 'expired'] as DisplayState[]).map((state) => (
          <span key={state} className="flex items-center gap-2">
            <span className={cx('h-3 w-3 rounded border', STATE_META[state].tile)} />
            {STATE_META[state].label}
          </span>
        ))}
      </div>
    </Panel>
  );

  const list = (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.07] px-5 py-5 sm:px-7">
        <div>
          <p className="eyebrow">Self-paced set</p>
          <h2 className="mt-1.5 font-display text-[24px] font-medium leading-tight text-white">Choose any question</h2>
          <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-white/60">
            Each question has its own timer. It starts the moment you press Start and cannot be paused.
          </p>
        </div>
        <Badge tone="gold">
          <Layers className="h-3 w-3" /> {counts.left} left
        </Badge>
      </div>
      <ol className="divide-y divide-white/[0.05]">
        {set.items.map((item) => {
          const state = displayState(item);
          const mine = exam.myAnswers[item.questionId];
          return (
            <li key={item.questionId} className="flex flex-wrap items-center gap-4 px-5 py-4 transition hover:bg-white/[0.02] sm:flex-nowrap sm:px-7">
              <span
                className={cx(
                  'num grid h-11 w-11 shrink-0 place-items-center rounded-xl border font-display text-[18px] font-medium',
                  STATE_META[state].tile
                )}
              >
                {item.index}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <TypePill type={item.type} />
                  <span className="text-[12.5px] text-white/55">{item.points} pts</span>
                  <span className="num inline-flex items-center gap-1 text-[12.5px] text-white/55">
                    <Timer className="h-3 w-3" /> {fmtDuration(item.timerSeconds)}
                  </span>
                </div>
                {item.prompt ? (
                  <p className="mt-1.5 line-clamp-2 text-[14.5px] leading-relaxed text-white/85">{item.prompt}</p>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[13.5px] italic text-white/45">
                    <Eye className="h-3.5 w-3.5" /> The question appears when you start it
                  </p>
                )}
                {state === 'answered' && mine && mine.grade !== 'pending' && (
                  <p className={cx('mt-1 text-[12.5px]', mine.grade === 'correct' ? 'text-mint-300' : 'text-ember-300')}>
                    {mine.grade === 'correct' ? `+${mine.awarded} pts` : 'Incorrect'}
                  </p>
                )}
                {(state === 'expired' || state === 'skipped') && (
                  <p className="mt-1 text-[12.5px] text-white/45">Closed for you — it opens again only if your teacher re-pushes it.</p>
                )}
              </div>
              <div className="flex w-full justify-end sm:w-auto">
                {state === 'available' ? (
                  <Button
                    variant="gold"
                    size="md"
                    className="w-full sm:w-auto"
                    onClick={() => requestStart(item)}
                    loading={openingId === item.questionId}
                    disabled={!!busy || !!running}
                  >
                    <Play className="h-4 w-4" /> Start · {fmtDuration(item.timerSeconds)}
                  </Button>
                ) : (
                  <span
                    className={cx(
                      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset',
                      STATE_META[state].chip
                    )}
                  >
                    {state === 'answered' && <CircleCheck className="h-3.5 w-3.5" />}
                    {state === 'saved' && <CloudUpload className="h-3.5 w-3.5" />}
                    {(state === 'expired' || state === 'skipped') && <XCircle className="h-3.5 w-3.5" />}
                    {state === 'open' && <Hourglass className="h-3.5 w-3.5" />}
                    {STATE_META[state].label}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );

  const questionCard = running && running.question && (
    <Panel className={cx('relative overflow-hidden transition', urgent && 'ring-1 ring-ember-500/40')}>
      <div className="relative h-1.5 w-full bg-white/[0.06]">
        <div
          className={cx(
            'h-full transition-[width] duration-300 ease-linear',
            urgent
              ? 'bg-gradient-to-r from-ember-500 to-amber-400'
              : allowance && remaining / allowance > 0.4
                ? 'bg-gradient-to-r from-mint-500 to-mint-300'
                : 'bg-gradient-to-r from-amber-500 to-amber-300'
          )}
          style={{ width: `${allowance ? Math.max(0, Math.min(100, (remaining / allowance) * 100)) : 0}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-center gap-2">
          <TypePill type={running.type} />
          <span className="text-[13px] text-white/60">
            Question {running.index} of {set.items.length} · {typeLabel(running.type)}
          </span>
          <span className="num text-[13px] text-white/50">· {running.points} pts</span>
        </div>
        <div className="hidden items-center gap-2 lg:flex" aria-live="off">
          <span className={cx('num text-[18px] font-semibold', urgent ? 'text-ember-300' : 'text-white')}>
            {fmtClock(remaining)}
          </span>
          <Timer className={cx('h-4 w-4', urgent ? 'text-ember-300' : 'text-white/45')} />
          {synced && <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">server</span>}
        </div>
      </div>

      <div className="p-5 sm:p-7">
        <div className="flex items-start gap-3.5">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-400/[0.1] font-display text-[16px] font-medium text-gold-200 ring-1 ring-inset ring-gold-300/25">
            {running.index}
          </span>
          <h2 className="font-display text-[19px] font-normal leading-[1.5] text-white sm:text-[22px]">
            {running.question.prompt}
          </h2>
        </div>

        <div className="mt-6">
          <AnswerInput
            question={running.question}
            draft={draft}
            onDraft={setDraft}
            disabled={busy !== null}
            onSubmitShortcut={() => void submit()}
          />
          <ShortcutHint type={running.type} />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-sm text-[12.5px] leading-relaxed text-white/55">
            {outbox.online
              ? 'One submission per question. Your timer is your own — classmates may be on other questions.'
              : 'Offline — your answer is saved on this device and sent automatically.'}
          </p>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {set.allowSkip && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => setConfirmSkip(true)}
                disabled={busy !== null || !outbox.online}
                className="flex-1 sm:flex-none"
              >
                <SkipForward className="h-4 w-4" /> Skip
              </Button>
            )}
            <Button
              variant="gold"
              size="lg"
              onClick={() => void submit()}
              loading={busy === 'submit'}
              disabled={!canSubmit}
              className="flex-1 px-7 sm:flex-none"
            >
              {outbox.online ? <Send className="h-4 w-4" /> : <CloudUpload className="h-4 w-4" />}
              {outbox.online ? 'Submit answer' : 'Save answer'}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );

  const outcomeMeta: Record<Outcome, { title: string; body: string; icon: typeof CircleCheck; tone: string }> = {
    answered: {
      title: 'Answer submitted',
      body: 'Your result unlocks when your teacher closes the set.',
      icon: CircleCheck,
      tone: 'bg-mint-500/[0.14] text-mint-300 ring-mint-400/30'
    },
    saved: {
      title: 'Saved on this device',
      body: 'It will be delivered the moment you reconnect.',
      icon: CloudUpload,
      tone: 'bg-amber-400/[0.13] text-amber-200 ring-amber-400/30'
    },
    skipped: {
      title: 'Question skipped',
      body: 'It stays closed for you unless your teacher re-pushes it.',
      icon: SkipForward,
      tone: 'bg-white/[0.06] text-white/75 ring-white/15'
    },
    expired: {
      title: "Time's up",
      body: 'This question is closed for you unless your teacher re-pushes it.',
      icon: Lock,
      tone: 'bg-ember-500/[0.13] text-ember-300 ring-ember-500/30'
    }
  };

  const interstitial = finished && finishedItem && (() => {
    const meta = outcomeMeta[finished.outcome];
    const Icon = meta.icon;
    return (
      <Panel className="gold-edge relative overflow-hidden p-6 text-center sm:p-10">
        <span className={cx('mx-auto grid h-14 w-14 place-items-center rounded-2xl ring-1 ring-inset', meta.tone)}>
          <Icon className="h-6 w-6" />
        </span>
        <p className="eyebrow mt-5">Question {finishedItem.index}</p>
        <h2 className="mt-1.5 font-display text-[1.8rem] font-normal leading-tight text-white">{meta.title}</h2>
        <p className="mx-auto mt-2 max-w-md text-[14.5px] leading-relaxed text-white/60">{meta.body}</p>

        {upNext ? (
          <div className="mx-auto mt-7 max-w-md rounded-2xl border border-white/[0.08] bg-ink-950/50 p-4 text-left">
            <div className="flex items-center gap-3">
              <span className="num grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-gold-300/40 bg-gold-400/[0.1] font-display text-[18px] text-gold-200">
                {upNext.index}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] uppercase tracking-[0.14em] text-white/50">Up next</p>
                <p className="mt-0.5 truncate text-[14.5px] text-white/90">
                  {upNext.prompt ?? `${typeLabel(upNext.type)} · ${upNext.points} pts`}
                </p>
                <p className="num mt-0.5 text-[12.5px] text-white/55">{fmtDuration(upNext.timerSeconds)} on the clock</p>
              </div>
              {countdown !== null && (
                <span className="num grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-gold-300/70 text-[16px] font-semibold text-gold-100">
                  {countdown}
                </span>
              )}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button variant="gold" size="md" onClick={() => void open(upNext)} loading={busy === 'open'} disabled={!outbox.online}>
                <Play className="h-4 w-4" /> Start now
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setFinished(null);
                  setCountdown(null);
                }}
              >
                Choose another
              </Button>
            </div>
            {countdown !== null && (
              <p className="mt-3 text-center text-[12.5px] text-white/50">Starting automatically in {countdown}s…</p>
            )}
          </div>
        ) : (
          <div className="mt-7">
            <p className="text-[14px] text-white/70">That was the last open question in this set.</p>
            <Button variant="secondary" size="md" className="mt-4" onClick={() => setFinished(null)}>
              <ListChecks className="h-4 w-4" /> See all questions
            </Button>
          </div>
        )}
      </Panel>
    );
  })();

  const allDone = !running && !finished && counts.left === 0;

  return (
    <div className="space-y-4">
      {/* status strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Badge tone="gold" dot>
            live
          </Badge>
          <span className="truncate text-[13.5px] text-white/70">
            {exam.title} · <span className="font-mono text-white/55">{exam.code}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-[13px] text-white/60">
            {counts.done} of {set.items.length} answered
          </span>
          <div
            className="h-1.5 w-28 overflow-hidden rounded-full bg-white/[0.08]"
            role="progressbar"
            aria-label="Set progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-royal-400 to-gold-300 transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <OfflineQueuePanel outbox={outbox} />
      <p className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-1.5 text-[12.5px] leading-snug text-amber-100/85">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />
        For exam integrity, leaving this tab during the live session is reported to faculty.
      </p>

      {/* Phone: a compact strip shows progress while a question is open. */}
      {running && (
        <div className="edge-fade-x -mx-4 overflow-x-auto px-4 lg:hidden">
          <div className="flex w-max gap-1.5 py-1">
            {set.items.map((item) => {
              const state = displayState(item);
              return (
                <span
                  key={item.questionId}
                  aria-hidden="true"
                  className={cx(
                    'num grid h-9 w-9 place-items-center rounded-lg border font-display text-[14px]',
                    STATE_META[state].tile
                  )}
                >
                  {item.index}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {running && (
        <MobileTimerBar
          remaining={remaining}
          total={allowance}
          urgent={urgent}
          label={`Question ${running.index} of ${set.items.length}`}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr] [&>*]:min-w-0">
        <div className="space-y-4">
          {running ? (
            questionCard
          ) : interstitial ? (
            interstitial
          ) : allDone ? (
            <Panel className="gold-edge relative overflow-hidden p-8 text-center sm:p-12">
              <div className="aura aura-gold left-1/2 top-[-6rem] h-64 w-64 -translate-x-1/2" />
              <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-b from-gold-300/25 to-gold-500/10 text-gold-200 ring-1 ring-inset ring-gold-300/35 shadow-gold">
                <Trophy className="h-7 w-7" />
              </span>
              <h2 className="relative mt-6 font-display text-[2rem] font-normal leading-tight text-white">
                You are done with this set.
              </h2>
              <p className="relative mx-auto mt-2 max-w-md text-[14.5px] leading-relaxed text-white/60">
                {counts.done} answered{counts.missed ? ` · ${counts.missed} closed` : ''}. Results unlock when your teacher
                closes the set — stay on this page and they appear here.
              </p>
              <Button variant="secondary" size="md" className="relative mt-6" onClick={() => void reload()}>
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
            </Panel>
          ) : (
            list
          )}
        </div>

        <div className="space-y-4">
          {running && (
            <Panel className="hidden p-6 lg:block">
              <div className="flex flex-col items-center">
                <RadialTimer remaining={remaining} total={allowance} size={172} urgent={urgent} />
                <p className="mt-3 flex items-center gap-1.5 text-[11.5px] uppercase tracking-[0.16em] text-white/55">
                  <Zap className="h-3 w-3 text-gold-300" /> your own timer
                </p>
              </div>
            </Panel>
          )}
          <div className={cx(!running && 'hidden lg:block')}>{navigatorPanel}</div>
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
                <Leaderboard entries={board} highlightId={userId} max={8} compact />
              </div>
            </Panel>
          )}
        </div>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? `Start question ${confirm.index}?` : 'Start question'}
        description={
          confirm
            ? `You will have ${fmtDuration(confirm.timerSeconds)}. The timer starts now and cannot be paused.`
            : undefined
        }
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
              Not yet
            </Button>
            <Button variant="gold" size="sm" loading={busy === 'open'} onClick={() => confirm && void open(confirm)}>
              <Play className="h-3.5 w-3.5" /> Start timer
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <TypePill type={confirm.type} />
              <span className="text-[13px] text-white/60">
                {typeLabel(confirm.type)} · {confirm.points} pts
              </span>
            </div>
            {confirm.prompt && <p className="font-display text-[17px] leading-relaxed text-white/90">{confirm.prompt}</p>}
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-white/65">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#DFB873]"
                checked={skipConfirmStart}
                onChange={(e) => setSkipConfirmStart(e.target.checked)}
              />
              Don&apos;t ask again for this set
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={confirmSkip}
        onClose={() => setConfirmSkip(false)}
        title="Skip this question?"
        description="It closes for you straight away, like a timeout. Only your teacher can re-open it."
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmSkip(false)}>
              Keep answering
            </Button>
            <Button variant="danger" size="sm" loading={busy === 'skip'} onClick={() => void skip()}>
              <SkipForward className="h-3.5 w-3.5" /> Skip question
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-white/60">
          <ArrowRight className="mr-1 inline h-3.5 w-3.5 text-gold-300" />
          {fmtClock(remaining)} left on question {running?.index}.
        </p>
      </Modal>
    </div>
  );
}
