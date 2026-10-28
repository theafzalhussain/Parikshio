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
  EyeOff,
  GraduationCap,
  Lock,
  Radio,
  Send,
  Sparkles,
  Timer,
  Users,
  Zap
} from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { AiEngineBadge, AiEvaluationCard, AiStatusChip, GradedByTag, isAiBusy } from '@/components/AiGrading';
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
import type {
  ActiveWindow,
  Exam,
  GradingStatus,
  LeaderboardEntry,
  Question,
  QuestionType,
  Response,
  StudentTabHiddenEvent
} from '@shared/types';

interface Detail {
  exam: Exam;
  questions: Question[];
  active: (ActiveWindow & { question: { id: string; prompt: string; type: QuestionType } }) | null;
  leaderboard: LeaderboardEntry[];
  grading: GradingStatus;
  responses: (Response & { questionPrompt: string; questionType: QuestionType; maxPoints: number })[];
}

type FeedRow = Detail['responses'][number];

interface ClassroomStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: number | null;
}

interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
}

interface SyncedClassroomStudent {
  classroomUserId: string;
  name: string;
  email: string;
  studentId: string | null;
}

const isSubjectiveType = (type: QuestionType) => type === 'short' || type === 'long';

/** Rows the "AI-grade pending" bulk action would pick up. */
const awaitsAi = (r: FeedRow) =>
  isSubjectiveType(r.questionType) &&
  r.gradedBy !== 'manual' &&
  r.answer.trim().length > 0 &&
  !isAiBusy(r.ai) &&
  (r.grade === 'pending' || r.ai?.status === 'failed');

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
  const [tabSwitches, setTabSwitches] = useState<StudentTabHiddenEvent[]>([]);
  const [classroom, setClassroom] = useState<ClassroomStatus | null>(null);
  const [classroomCourses, setClassroomCourses] = useState<ClassroomCourse[]>([]);
  const [selectedClassroomCourse, setSelectedClassroomCourse] = useState('');
  const [classroomRoster, setClassroomRoster] = useState<SyncedClassroomStudent[]>([]);
  const [classroomBusy, setClassroomBusy] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [grading, setGrading] = useState<Detail['responses'][number] | null>(null);
  const [gradeValue, setGradeValue] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [engine, setEngine] = useState<GradingStatus | null>(null);
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const detailRef = useRef<Detail | null>(null);
  detailRef.current = detail;

  const load = useCallback(async () => {
    try {
      const res = await api<Detail>(`/exams/${examId}`);
      setDetail(res);
      setBoard(res.leaderboard);
      setFeed(res.responses);
      setEngine(res.grading);
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

  const loadClassroom = useCallback(async () => {
    try {
      const { classroom: status } = await api<{ classroom: ClassroomStatus }>('/classroom/status');
      setClassroom(status);
      if (status.connected) {
        const { courses } = await api<{ courses: ClassroomCourse[] }>('/classroom/courses');
        setClassroomCourses(courses);
      } else {
        setClassroomCourses([]);
      }
    } catch (err) {
      push({ kind: 'error', title: 'Could not load Google Classroom', body: (err as Error).message });
    }
  }, [push]);

  useEffect(() => {
    void loadClassroom();
  }, [loadClassroom]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('classroom');
    if (!result) return;
    if (result === 'connected') {
      push({ kind: 'success', title: 'Google Classroom connected' });
      void loadClassroom();
    } else if (result === 'denied') {
      push({ kind: 'warn', title: 'Google Classroom connection was cancelled' });
    } else if (result === 'error') {
      push({ kind: 'error', title: 'Google Classroom connection failed', body: 'Check the OAuth setup and try connecting again.' });
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('classroom');
    window.history.replaceState({}, '', url);
  }, [push, loadClassroom]);

  useEffect(() => {
    setSelectedClassroomCourse(detail?.exam.classroomCourseId ?? '');
  }, [detail?.exam.classroomCourseId]);

  // realtime wiring
  useEffect(() => {
    const code = detailRef.current?.exam.code;
    if (!code) return;
    const join = () => socket.emit('join:exam', { examCode: code, role: 'admin' });
    // Socket.io rooms do not survive a reconnect: rejoin the staff room, and
    // reload so submissions and AI grades that landed while this device was
    // offline show up without a manual refresh.
    const onReconnect = () => {
      join();
      void load();
    };
    if (socket.connected) join();
    socket.on('connect', onReconnect);

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
    // AI results (and progress) and grade overrides land here in real time.
    const onGraded = (payload: { examId: string; response: Response }) => {
      if (payload.examId !== examId) return;
      setFeed((prev) => {
        const idx = prev.findIndex((r) => r.id === payload.response.id);
        if (idx === -1) {
          const question = detailRef.current?.questions.find((q) => q.id === payload.response.questionId);
          return [
            {
              ...payload.response,
              questionPrompt: question?.prompt ?? '',
              questionType: question?.type ?? 'short',
              maxPoints: question?.points ?? 0
            },
            ...prev
          ];
        }
        const next = [...prev];
        next[idx] = { ...next[idx], ...payload.response };
        return next;
      });
    };
    const onLocked = () => void load();
    const onEnded = () => void load();
    const onTabHidden = (event: StudentTabHiddenEvent) => {
      if (event.examId !== examId) return;
      setTabSwitches((previous) => [event, ...previous].slice(0, 20));
      push({
        kind: 'warn',
        title: 'Student left the exam tab',
        body: `${event.studentName} · student ID ${event.studentId}`
      });
    };

    socket.on('response:new', onResponse);
    socket.on('response:graded', onGraded);
    socket.on('leaderboard:update', onBoard);
    socket.on('student:tab-hidden', onTabHidden);
    socket.on('question:locked', onLocked);
    socket.on('exam:ended', onEnded);
    return () => {
      socket.off('connect', onReconnect);
      socket.off('response:new', onResponse);
      socket.off('response:graded', onGraded);
      socket.off('leaderboard:update', onBoard);
      socket.off('student:tab-hidden', onTabHidden);
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
      const result = await api<{
        classroom?: { status: 'published' | 'already-published' | 'failed'; error?: string; gradedStudents?: number };
      }>(`/exams/${examId}/end`, { method: 'POST' });
      push({
        kind: result.classroom?.status === 'failed' ? 'warn' : 'info',
        title: 'Session ended',
        body: result.classroom?.status === 'failed'
          ? `Classroom results were not posted: ${result.classroom.error ?? 'retry from the integration panel.'}`
          : result.classroom
            ? `Classroom results posted for ${result.classroom.gradedStudents ?? 0} students.`
            : 'Analytics are final.'
      });
      setConfirmEnd(false);
      await load();
    } catch (err) {
      push({ kind: 'error', title: 'Could not end session', body: (err as Error).message });
    }
  }

  async function connectClassroom() {
    setClassroomBusy(true);
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>('/classroom/oauth/start', {
        method: 'POST',
        body: { examId }
      });
      window.location.assign(authorizationUrl);
    } catch (err) {
      push({ kind: 'error', title: 'Could not start Google Classroom connection', body: (err as Error).message });
      setClassroomBusy(false);
    }
  }

  async function disconnectClassroom() {
    setClassroomBusy(true);
    try {
      await api('/classroom/disconnect', { method: 'POST' });
      setClassroomRoster([]);
      setSelectedClassroomCourse('');
      await loadClassroom();
      await load();
      push({ kind: 'success', title: 'Google Classroom disconnected' });
    } catch (err) {
      push({ kind: 'error', title: 'Could not disconnect Google Classroom', body: (err as Error).message });
    } finally {
      setClassroomBusy(false);
    }
  }

  async function saveClassroomCourse() {
    if (!selectedClassroomCourse) return;
    setClassroomBusy(true);
    try {
      const result = await api<{ exam: Exam }>(`/exams/${examId}/classroom/course`, {
        method: 'POST',
        body: { courseId: selectedClassroomCourse }
      });
      setDetail((current) => current ? { ...current, exam: result.exam } : current);
      setClassroomRoster([]);
      push({ kind: 'success', title: 'Google Classroom course linked', body: result.exam.classroomCourseName ?? selectedClassroomCourse });
    } catch (err) {
      push({ kind: 'error', title: 'Could not link Classroom course', body: (err as Error).message });
    } finally {
      setClassroomBusy(false);
    }
  }

  async function syncClassroomRoster() {
    setClassroomBusy(true);
    try {
      const result = await api<{
        roster: SyncedClassroomStudent[];
        matchedCount: number;
        unmatchedCount: number;
      }>(`/exams/${examId}/classroom/sync-roster`, { method: 'POST' });
      setClassroomRoster(result.roster);
      push({
        kind: result.unmatchedCount ? 'warn' : 'success',
        title: 'Class roster synced',
        body: `${result.matchedCount} matched to existing students · ${result.unmatchedCount} unmatched`
      });
    } catch (err) {
      push({ kind: 'error', title: 'Could not sync roster', body: (err as Error).message });
    } finally {
      setClassroomBusy(false);
    }
  }

  async function publishClassroomResults() {
    setClassroomBusy(true);
    try {
      const result = await api<{ classroom: { gradedStudents: number } }>(
        `/exams/${examId}/classroom/publish-results`,
        { method: 'POST' }
      );
      push({
        kind: 'success',
        title: 'Classroom results published',
        body: `${result.classroom.gradedStudents} student grades posted.`
      });
      await load();
    } catch (err) {
      push({ kind: 'error', title: 'Classroom results not published', body: (err as Error).message });
      await load();
    } finally {
      setClassroomBusy(false);
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

  /** Queue (or re-run) the AI evaluator for one response; the result streams in over the socket. */
  async function rerunAi(row: FeedRow) {
    setAiBusyId(row.id);
    try {
      const res = await api<{ response: Response; queued: boolean }>(`/responses/${row.id}/ai-grade`, { method: 'POST' });
      setFeed((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...res.response } : r)));
      push({
        kind: 'info',
        title: res.queued ? 'Sent to the AI evaluator' : 'Already being evaluated',
        body: `${row.studentName}'s answer — the score updates here automatically.`
      });
    } catch (err) {
      push({ kind: 'error', title: 'AI evaluation not started', body: (err as Error).message });
    } finally {
      setAiBusyId(null);
    }
  }

  async function bulkAi() {
    setBulkBusy(true);
    try {
      const res = await api<{ queued: number; skipped: number; grading: GradingStatus }>(`/exams/${examId}/ai-grade`, {
        method: 'POST',
        body: { scope: 'pending' }
      });
      setEngine(res.grading);
      push({
        kind: res.queued ? 'success' : 'info',
        title: res.queued ? `${res.queued} answer${res.queued === 1 ? '' : 's'} sent to AI` : 'Nothing to grade',
        body: res.queued
          ? 'Scores appear in the feed as each evaluation finishes.'
          : 'Every short and long answer already has a grade or is in the queue.'
      });
    } catch (err) {
      push({ kind: 'error', title: 'Bulk AI grading failed', body: (err as Error).message });
    } finally {
      setBulkBusy(false);
    }
  }

  const aiEnabled = !!engine?.ai.enabled;
  const aiInFlight = feed.filter((r) => isAiBusy(r.ai)).length;
  const aiPending = feed.filter(awaitsAi).length;
  // Keep the open scoring modal in sync with live AI updates for the same row.
  const gradingRow = grading ? feed.find((r) => r.id === grading.id) ?? grading : null;

  const exam = detail?.exam;

  return (
    <AdminShell
      title={exam?.title ?? 'Session'}
      subtitle={exam ? `${exam.subject} · join code ${exam.code} · ${exam.questionIds.length} questions` : undefined}
      action={
        <div className="flex items-center gap-2">
          <AiEngineBadge status={engine} busy={aiInFlight} />
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
                  sub={
                    aiEnabled
                      ? 'MCQ, True/False and Fill are graded by the answer key instantly · Short and Long answers are scored by the AI evaluator as they arrive.'
                      : 'Timestamped on arrival · latency measured from the moment you pushed.'
                  }
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      {aiEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={bulkAi}
                          loading={bulkBusy}
                          disabled={aiPending === 0}
                          title="Send every ungraded or failed short/long answer in this session to the AI evaluator"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> AI-grade pending{aiPending ? ` (${aiPending})` : ''}
                        </Button>
                      )}
                      <Badge tone="lime">{feed.length} captured</Badge>
                    </div>
                  }
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
                      {isSubjectiveType(r.questionType) && <AiStatusChip ai={r.ai} />}
                      <GradePill grade={r.grade} awarded={r.awarded} points={r.maxPoints} />
                      {r.ai?.status === 'failed' && aiEnabled && r.gradedBy !== 'manual' && (
                        <Button size="sm" variant="ghost" onClick={() => rerunAi(r)} loading={aiBusyId === r.id}>
                          Retry AI
                        </Button>
                      )}
                      {r.grade === 'pending' && !isAiBusy(r.ai) ? (
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
                          {r.ai?.status === 'done' ? 'review' : 'edit'}
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

              <Panel className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">Integrity monitor</p>
                    <h3 className="mt-1 text-[15px] font-semibold text-white">Tab switches</h3>
                  </div>
                  <Badge tone={tabSwitches.length ? 'amber' : 'neutral'}>
                    <EyeOff className="h-3 w-3" /> {tabSwitches.length}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[11px] text-white/35">
                  Alerts are sent when a student hides this live exam tab.
                </p>
                <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                  {tabSwitches.length === 0 ? (
                    <p className="py-4 text-center text-[11px] text-white/30">No tab switches reported.</p>
                  ) : (
                    tabSwitches.map((event) => (
                      <div
                        key={`${event.studentId}:${event.hiddenAt}`}
                        className="rounded-xl border border-amber-300/10 bg-amber-300/[0.04] p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[11.5px] font-medium text-white/80">{event.studentName}</p>
                          <span className="num shrink-0 text-[10px] text-white/35">
                            {new Date(event.hiddenAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="mt-1 break-all font-mono text-[10px] text-white/35">
                          Student ID: {event.studentId}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </Panel>

              <Panel className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">Google Classroom</p>
                    <h3 className="mt-1 text-[15px] font-semibold text-white">Roster & results</h3>
                  </div>
                  <GraduationCap className="h-4 w-4 text-sky-300" />
                </div>
                {!classroom?.configured ? (
                  <p className="mt-3 rounded-lg border border-amber-300/10 bg-amber-300/[0.04] p-3 text-[11px] leading-relaxed text-amber-100/65">
                    Google Classroom is not configured on this server. Set the OAuth Client ID and Client Secret to enable it.
                  </p>
                ) : !classroom.connected ? (
                  <>
                    <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                      Connect a teacher account to link this exam to a course, match the roster to existing student accounts, and publish scores.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3 w-full"
                      disabled={classroomBusy}
                      onClick={connectClassroom}
                    >
                      <GraduationCap className="h-3.5 w-3.5" /> Connect Google Classroom
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-300/10 bg-emerald-300/[0.04] p-2.5">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.1em] text-emerald-200/50">Connected teacher</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-white/75">{classroom.email}</p>
                      </div>
                      <button
                        type="button"
                        disabled={classroomBusy}
                        onClick={disconnectClassroom}
                        className="shrink-0 text-[10px] text-white/35 transition hover:text-rose-200 disabled:opacity-40"
                      >
                        Disconnect
                      </button>
                    </div>

                    <span className="mt-3 block text-[10px] uppercase tracking-[0.12em] text-white/40">Course for this exam</span>
                    <select
                      value={selectedClassroomCourse}
                      onChange={(event) => setSelectedClassroomCourse(event.target.value)}
                      disabled={classroomBusy || exam.status === 'ended'}
                      className="mt-1.5 w-full rounded-lg border border-white/[0.09] bg-[#111419] px-3 py-2 text-[11.5px] text-white/75 outline-none focus:border-sky-300/30 disabled:opacity-50"
                    >
                      <option value="">Select a Classroom course</option>
                      {classroomCourses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.name}{course.section ? ` · ${course.section}` : ''}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2 w-full"
                      disabled={classroomBusy || !selectedClassroomCourse || exam.status === 'ended'}
                      onClick={saveClassroomCourse}
                    >
                      {exam.classroomCourseId === selectedClassroomCourse ? 'Update linked course' : 'Link course'}
                    </Button>

                    {exam.classroomCourseId && (
                      <>
                        <Divider className="my-3" />
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] text-white/50">Linked: {exam.classroomCourseName ?? exam.classroomCourseId}</p>
                          <button
                            type="button"
                            disabled={classroomBusy}
                            onClick={syncClassroomRoster}
                            className="shrink-0 text-[10px] font-medium text-sky-200/70 transition hover:text-sky-100 disabled:opacity-40"
                          >
                            Sync roster
                          </button>
                        </div>
                        {classroomRoster.length > 0 && (
                          <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto">
                            {classroomRoster.map((student) => (
                              <div key={student.classroomUserId} className="flex items-center justify-between gap-2 text-[10.5px]">
                                <span className="min-w-0 truncate text-white/60">{student.name} · {student.email}</span>
                                <span className={cx('shrink-0', student.studentId ? 'text-emerald-200/70' : 'text-amber-200/70')}>
                                  {student.studentId ? 'Matched' : 'No account'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {exam.classroomPublishStatus && (
                          <div className={cx(
                            'mt-3 rounded-lg border p-2.5 text-[10.5px]',
                            exam.classroomPublishStatus === 'published'
                              ? 'border-emerald-300/10 bg-emerald-300/[0.04] text-emerald-100/70'
                              : 'border-rose-300/10 bg-rose-300/[0.04] text-rose-100/70'
                          )}>
                            <p>
                              {exam.classroomPublishStatus === 'published'
                                ? `Results published${exam.classroomPublishedAt ? ` · ${new Date(exam.classroomPublishedAt).toLocaleString()}` : ''}`
                                : `Publication failed: ${exam.classroomPublishError ?? 'unknown error'}`}
                            </p>
                          </div>
                        )}
                        {exam.status === 'ended' && exam.classroomPublishStatus !== 'published' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mt-2 w-full"
                            disabled={classroomBusy}
                            onClick={publishClassroomResults}
                          >
                            Retry result publishing
                          </Button>
                        )}
                      </>
                    )}
                  </>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={!!gradingRow}
        onClose={() => setGrading(null)}
        title="Score this response"
        description={gradingRow ? `${gradingRow.studentName} · ${gradingRow.questionPrompt.slice(0, 90)}` : undefined}
        width="max-w-2xl"
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
        {gradingRow && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10.5px] uppercase tracking-[0.12em] text-white/30">student answer</p>
                <GradedByTag mode={gradingRow.gradedBy} />
              </div>
              <p className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/75">
                {gradingRow.answer || '— no answer submitted —'}
              </p>
            </div>
            {isSubjectiveType(gradingRow.questionType) && (
              <AiEvaluationCard
                response={gradingRow}
                aiEnabled={aiEnabled}
                rerunning={aiBusyId === gradingRow.id}
                onRerun={() => rerunAi(gradingRow)}
                onAccept={(score) => setGradeValue(String(score))}
              />
            )}
            <div>
              <Label htmlFor="grade-awarded" hint={`max ${gradingRow.maxPoints} · half marks allowed`}>
                Awarded points
              </Label>
              <Input id="grade-awarded"
                type="number"
                min={0}
                step={0.5}
                max={gradingRow.maxPoints}
                value={gradeValue}
                onChange={(e) => setGradeValue(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              {[...new Set([0, Math.round(gradingRow.maxPoints / 2), gradingRow.maxPoints])].map((v) => (
                <Button key={v} size="sm" variant="ghost" onClick={() => setGradeValue(String(v))}>
                  <Check className="h-3 w-3" /> {v} pts
                </Button>
              ))}
            </div>
            {gradingRow.ai?.status === 'done' && gradingRow.gradedBy !== 'manual' && (
              <p className="text-[11px] text-white/35">
                Saving here overrides the AI score with your own — the AI evaluation stays on record.
              </p>
            )}
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
