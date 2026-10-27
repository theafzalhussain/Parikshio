'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  CircleStop,
  Copy,
  Lock,
  Radio,
  Send,
  Timer,
  Users,
  Zap
} from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { RadialTimer } from '@/components/charts/Charts';
import { Leaderboard } from '@/components/Leaderboard';
import { Badge, Divider, EmptyState, Panel, SectionHead } from '@/components/ui/Panel';
import { Button, IconButton, LinkButton } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Avatar, GradePill, Loading, StatusPill, TypePill, typeLabel } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, cx, fmtMs, fmtRelative } from '@/lib/api';
import { useServerClock, useSocket } from '@/lib/socket';
import type { ActiveWindow, Exam, LeaderboardEntry, Question, QuestionType, Response } from '@shared/types';

interface Detail {
  exam: Exam;
  questions: Question[];
  active: (ActiveWindow & { question: { id: string; prompt: string; type: QuestionType } }) | null;
  leaderboard: LeaderboardEntry[];
  responses: (Response & { questionPrompt: string; questionType: QuestionType; maxPoints: number })[];
}

function AnswerChip({
  response,
  options
}: {
  response: { answer: string; questionType: QuestionType };
  options: string[];
}) {
  const objective = response.questionType === 'mcq' || response.questionType === 'truefalse';
  if (!objective)
    return (
      <p className="max-w-[200px] truncate text-[11.5px] italic text-white/45" title={response.answer}>
        “{response.answer}”
      </p>
    );
  const idx = Number(response.answer);
  return (
    <p className="max-w-[200px] truncate text-[11.5px] text-white/55" title={options[idx]}>
      <span className="mr-1 rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[10px] text-white/70">
        {String.fromCharCode(65 + idx)}
      </span>
      {options[idx] ?? '—'}
    </p>
  );
}

export default function ControlRoomPage() {
  const params = useParams<{ id: string }>();
  const examId = params?.id ?? '';
  const socket = useSocket();
  const { now } = useServerClock(socket);
  const { push } = useToast();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [feed, setFeed] = useState<Detail['responses']>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [grading, setGrading] = useState<Detail['responses'][number] | null>(null);
  const [gradeValue, setGradeValue] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const detailRef = useRef<Detail | null>(null);
  detailRef.current = detail;

  const load = useCallback(async () => {
    try {
      const res = await api<Detail>(`/exams/${examId}`);
      setDetail(res);
      setBoard(res.leaderboard);
      setFeed(res.responses);
      setOverrides((prev) => {
        const next = { ...prev };
        res.questions.forEach((q) => {
          if (next[q.id] === undefined) next[q.id] = q.timerSeconds;
        });
        return next;
      });
    } catch (err) {
      push({ kind: 'error', title: 'Could not load session', body: (err as Error).message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  // realtime wiring
  useEffect(() => {
    const code = detailRef.current?.exam.code;
    if (!code) return;
    socket.emit('join:exam', { examCode: code, role: 'admin' });

    const onResponse = (payload: { examId: string; response: Response; questionPrompt: string }) => {
      if (payload.examId !== examId) return;
      const question = detailRef.current?.questions.find((q) => q.id === payload.response.questionId);
      setFeed((prev) => [
        {
          ...payload.response,
          questionPrompt: payload.questionPrompt,
          questionType: question?.type ?? 'mcq',
          maxPoints: question?.points ?? 0
        },
        ...prev.filter((r) => r.id !== payload.response.id)
      ]);
    };
    const onBoard = (payload: { examId: string; entries: LeaderboardEntry[] }) => {
      if (payload.examId === examId) setBoard(payload.entries);
    };
    const onLocked = () => void load();
    const onEnded = () => void load();

    socket.on('response:new', onResponse);
    socket.on('leaderboard:update', onBoard);
    socket.on('question:locked', onLocked);
    socket.on('exam:ended', onEnded);
    return () => {
      socket.off('response:new', onResponse);
      socket.off('leaderboard:update', onBoard);
      socket.off('question:locked', onLocked);
      socket.off('exam:ended', onEnded);
    };
  }, [socket, examId, detail?.exam.code, load]);

  const active = detail?.active ?? null;
  const remaining = active ? Math.max(0, active.endsAt - now) : 0;
  const total = active ? active.endsAt - active.pushedAt : 0;

  const queued = useMemo(() => {
    if (!detail) return [];
    return detail.exam.questionIds
      .map((id) => detail.questions.find((q) => q.id === id))
      .filter((q): q is Question => !!q);
  }, [detail]);

  const pushedIds = new Set((detail?.active ? [detail.active.questionId] : []).concat([]));

  async function pushQuestion(question: Question) {
    setBusyId(question.id);
    try {
      await api(`/exams/${examId}/push`, {
        method: 'POST',
        body: { questionId: question.id, timerSeconds: overrides[question.id] ?? question.timerSeconds }
      });
      push({
        kind: 'success',
        title: 'Question pushed live',
        body: `${overrides[question.id] ?? question.timerSeconds}s timer started on every student device.`
      });
      await load();
    } catch (err) {
      push({ kind: 'error', title: 'Push failed', body: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  async function lockNow() {
    try {
      await api(`/exams/${examId}/lock`, { method: 'POST' });
      push({ kind: 'warn', title: 'Question locked', body: 'Late submissions are now rejected.' });
      await load();
    } catch (err) {
      push({ kind: 'error', title: 'Could not lock', body: (err as Error).message });
    }
  }

  async function endSession() {
    try {
      await api(`/exams/${examId}/end`, { method: 'POST' });
      push({ kind: 'info', title: 'Session ended', body: 'Analytics are final.' });
      setConfirmEnd(false);
      await load();
    } catch (err) {
      push({ kind: 'error', title: 'Could not end session', body: (err as Error).message });
    }
  }

  async function submitGrade() {
    if (!grading) return;
    try {
      await api(`/responses/${grading.id}/grade`, { method: 'POST', body: { awarded: Number(gradeValue) } });
      push({ kind: 'success', title: 'Score saved', body: `${grading.studentName} → ${gradeValue} pts` });
      setGrading(null);
      await load();
    } catch (err) {
      push({ kind: 'error', title: 'Could not save score', body: (err as Error).message });
    }
  }

  const exam = detail?.exam;

  return (
    <AdminShell
      title={exam?.title ?? 'Session'}
      subtitle={exam ? `${exam.subject} · join code ${exam.code} · ${exam.questionIds.length} questions` : undefined}
      action={
        <div className="flex items-center gap-2">
          {exam && <StatusPill status={exam.status} />}
          <LinkButton href={`/admin/analytics/${examId}`} variant="secondary" size="sm">
            <BarChart3 className="h-3.5 w-3.5" /> Analytics
          </LinkButton>
        </div>
      }
    >
      {!detail || !exam ? (
        <Panel className="p-6">
          <Loading label="Opening the control room" />
        </Panel>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/admin/exams" className="inline-flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> All sessions
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(exam.code);
                  push({ kind: 'info', title: 'Join code copied', body: `Students join with ${exam.code}` });
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11.5px] text-white/60 transition hover:text-white"
              >
                <Copy className="h-3.5 w-3.5" /> {exam.code}
              </button>
              {exam.status === 'live' && (
                <Button variant="danger" size="sm" onClick={() => setConfirmEnd(true)}>
                  <CircleStop className="h-3.5 w-3.5" /> End session
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            {/* left */}
            <div className="space-y-4">
              {/* now live */}
              <Panel className="relative overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] bg-white/[0.02] px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Radio className={cx('h-3.5 w-3.5', active && !active.locked ? 'text-lime-400' : 'text-white/25')} />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                      {active ? (active.locked ? 'locked' : 'now live') : 'idle'}
                    </span>
                  </div>
                  {active && (
                    <span className="num text-[11px] text-white/35">
                      Question {active.index} of {active.total}
                    </span>
                  )}
                </div>

                {active ? (
                  <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <TypePill type={active.question.type} />
                        <Badge tone="neutral">{typeLabel(active.question.type)}</Badge>
                        {active.locked && <Badge tone="ember">accepting no more answers</Badge>}
                      </div>
                      <p className="text-[14px] leading-relaxed text-white/90">{active.question.prompt}</p>
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {[
                          { k: 'answers', v: feed.filter((f) => f.questionId === active.questionId).length },
                          {
                            k: 'correct',
                            v: feed.filter((f) => f.questionId === active.questionId && f.grade === 'correct').length
                          },
                          { k: 'timer set', v: `${Math.round((active.endsAt - active.pushedAt) / 1000)}s` }
                        ].map((s) => (
                          <div key={s.k} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
                            <p className="num text-[15px] font-semibold text-white">{s.v}</p>
                            <p className="text-[9.5px] uppercase tracking-[0.12em] text-white/30">{s.k}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={lockNow} disabled={active.locked}>
                          <Lock className="h-3.5 w-3.5" /> Lock now
                        </Button>
                        {queued[active.index] && (
                          <Button variant="lime" size="sm" onClick={() => pushQuestion(queued[active.index])} loading={busyId === queued[active.index].id}>
                            <Send className="h-3.5 w-3.5" /> Push next
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <RadialTimer
                        remaining={active.locked ? 0 : remaining}
                        total={total}
                        size={150}
                        urgent={!active.locked && remaining < 10_000}
                      />
                      <p className="text-[10.5px] uppercase tracking-[0.14em] text-white/30">
                        {active.locked ? 'closed' : 'server clock'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-5">
                    <EmptyState
                      icon={<Radio className="h-5 w-5" />}
                      title={exam.status === 'ended' ? 'This session has ended' : 'Nothing is live right now'}
                      body={
                        exam.status === 'ended'
                          ? 'Open analytics to review final scores and per-question accuracy.'
                          : 'Pick a question from the queue below and push it to start the timer.'
                      }
                      action={
                        exam.status === 'ended' ? (
                          <LinkButton href={`/admin/analytics/${examId}`} size="sm" variant="outline">
                            <BarChart3 className="h-3.5 w-3.5" /> Open analytics
                          </LinkButton>
                        ) : (
                          queued[0] && (
                            <Button size="sm" variant="lime" onClick={() => pushQuestion(queued[0])}>
                              <Zap className="h-3.5 w-3.5" /> Push question 1
                            </Button>
                          )
                        )
                      }
                    />
                  </div>
                )}
              </Panel>

              {/* queue */}
              <Panel className="p-5">
                <SectionHead
                  eyebrow="Queue"
                  title="Question delivery"
                  sub="Override the timer per push. The lock is enforced server-side, so no answer sneaks in late."
                />
                <div className="mt-4 space-y-2">
                  {queued.map((q, idx) => {
                    const isActive = active?.questionId === q.id;
                    const delivered = active ? idx + 1 <= active.index : false;
                    return (
                      <div
                        key={q.id}
                        className={cx(
                          'flex flex-wrap items-center gap-3 rounded-2xl border p-3 transition',
                          isActive
                            ? 'border-lime-400/35 bg-lime-400/[0.06]'
                            : 'border-white/[0.07] bg-white/[0.02]'
                        )}
                      >
                        <span
                          className={cx(
                            'num grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-semibold ring-1 ring-inset',
                            isActive
                              ? 'bg-lime-400/20 text-lime-200 ring-lime-400/35'
                              : delivered
                                ? 'bg-white/[0.05] text-white/40 ring-white/10'
                                : 'bg-white/[0.03] text-white/30 ring-white/[0.08]'
                          )}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-1 text-[12.5px] text-white/80">{q.prompt}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <TypePill type={q.type} />
                            <span className="text-[10.5px] text-white/30">{q.topic}</span>
                            <span className="num text-[10.5px] text-white/30">· {q.points} pts</span>
                            {isActive && <Badge tone="lime">on screen</Badge>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="relative">
                            <Timer className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white/25" />
                            <Input
                              type="number"
                              min={5}
                              max={3600}
                              value={overrides[q.id] ?? q.timerSeconds}
                              onChange={(e) =>
                                setOverrides((prev) => ({ ...prev, [q.id]: Number(e.target.value) }))
                              }
                              className="w-[86px] py-1.5 pl-7 text-[12px]"
                              aria-label={`Timer for question ${idx + 1}`}
                            />
                          </div>
                          <Button
                            size="sm"
                            variant={isActive ? 'secondary' : 'outline'}
                            onClick={() => pushQuestion(q)}
                            loading={busyId === q.id}
                            disabled={exam.status === 'ended'}
                          >
                            {isActive ? 'Re-push' : 'Push'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>

              {/* submissions */}
              <Panel className="p-5">
                <SectionHead
                  eyebrow="Live feed"
                  title="Submissions"
                  sub="Timestamped on arrival · latency measured from the moment you pushed."
                  action={<Badge tone="lime">{feed.length} captured</Badge>}
                />
                <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {feed.length === 0 && (
                    <p className="py-10 text-center text-[12px] text-white/30">Waiting for the first answer…</p>
                  )}
                  {feed.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                    >
                      <Avatar name={r.studentName} size={26} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] text-white/80">{r.studentName}</p>
                        <p className="truncate text-[10.5px] text-white/30">
                          {r.questionPrompt.slice(0, 64)}
                          {r.questionPrompt.length > 64 ? '…' : ''}
                        </p>
                      </div>
                      <AnswerChip
                        response={r}
                        options={detail.questions.find((q) => q.id === r.questionId)?.options ?? []}
                      />
                      <span className="num text-[10.5px] text-white/30">{fmtMs(r.latencyMs)}</span>
                      <GradePill grade={r.grade} awarded={r.awarded} points={r.maxPoints} />
                      {r.grade === 'pending' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setGrading(r);
                            setGradeValue(String(r.maxPoints));
                          }}
                        >
                          Score
                        </Button>
                      ) : (
                        <button
                          onClick={() => {
                            setGrading(r);
                            setGradeValue(String(r.awarded));
                          }}
                          className="text-[10.5px] text-white/25 underline-offset-2 hover:text-white/60 hover:underline"
                        >
                          edit
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* right rail */}
            <div className="space-y-4">
              <Panel className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="eyebrow">Ranking</p>
                    <h3 className="mt-1 text-[15px] font-semibold text-white">Leaderboard</h3>
                  </div>
                  <Badge tone="lime">
                    <Users className="h-3 w-3" /> {board.length}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[11px] text-white/35">Accuracy first, then response speed.</p>
                <div className="mt-3">
                  <Leaderboard entries={board} max={10} />
                </div>
              </Panel>

              <Panel className="p-5">
                <p className="eyebrow">Session</p>
                <div className="mt-3 space-y-2.5 text-[12px]">
                  {[
                    ['Join code', exam.code],
                    ['Status', exam.status],
                    ['Questions', String(exam.questionIds.length)],
                    ['Participants', String(board.length)],
                    ['Created', fmtRelative(exam.createdAt)]
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <span className="text-white/35">{k}</span>
                      <span className="truncate font-mono text-[11.5px] text-white/75">{v}</span>
                    </div>
                  ))}
                </div>
                <Divider className="my-3" />
                <LinkButton href={`/admin/analytics/${examId}`} variant="outline" size="sm" className="w-full">
                  <BarChart3 className="h-3.5 w-3.5" /> Full analytics
                  <ArrowRight className="h-3.5 w-3.5" />
                </LinkButton>
              </Panel>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={!!grading}
        onClose={() => setGrading(null)}
        title="Score this response"
        description={grading ? `${grading.studentName} · ${grading.questionPrompt.slice(0, 90)}` : undefined}
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setGrading(null)}>
              Cancel
            </Button>
            <Button variant="lime" size="sm" onClick={submitGrade}>
              Save score
            </Button>
          </>
        }
      >
        {grading && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <p className="text-[10.5px] uppercase tracking-[0.12em] text-white/30">student answer</p>
              <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/75">
                {grading.answer || '— no answer submitted —'}
              </p>
            </div>
            <div>
              <Label htmlFor="grade-awarded" hint={`max ${grading.maxPoints}`}>Awarded points</Label>
              <Input id="grade-awarded"
                type="number"
                min={0}
                max={grading.maxPoints}
                value={gradeValue}
                onChange={(e) => setGradeValue(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              {[0, Math.round(grading.maxPoints / 2), grading.maxPoints].map((v) => (
                <Button key={v} size="sm" variant="ghost" onClick={() => setGradeValue(String(v))}>
                  <Check className="h-3 w-3" /> {v} pts
                </Button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End this session?"
        description="Students will be locked out immediately and the analytics snapshot becomes final. This cannot be undone."
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmEnd(false)}>
              Keep running
            </Button>
            <Button variant="danger" size="sm" onClick={endSession}>
              <CircleStop className="h-3.5 w-3.5" /> End session
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-white/50">
          {board.length} students have answered so far with {feed.length} responses captured. Export or review from the
          analytics page after ending.
        </p>
      </Modal>
    </AdminShell>
  );
}
