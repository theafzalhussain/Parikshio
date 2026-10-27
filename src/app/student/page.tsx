'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Clock,
  KeyRound,
  Radio,
  Target,
  Timer,
  TrendingUp
} from 'lucide-react';
import { StudentShell } from '@/components/StudentShell';
import { Badge, EmptyState, Panel, SectionHead, Stat } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Loading, StatusPill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, fmtMs, fmtRelative } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ExamStatus } from '@shared/types';

interface ExamCard {
  id: string;
  code: string;
  title: string;
  subject: string;
  status: ExamStatus;
  totalQuestions: number;
  adminName: string;
  endedAt?: number;
}

interface HistoryRow {
  examId: string;
  title: string;
  subject: string;
  status: ExamStatus;
  answered: number;
  correct: number;
  points: number;
  maxPoints: number;
  rank: number | null;
  cohort: number;
  avgLatencyMs: number;
  lastAt: number;
}

export default function StudentLobby() {
  const router = useRouter();
  const { user } = useAuth();
  const { push } = useToast();
  const [exams, setExams] = useState<ExamCard[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ exams: ExamCard[] }>('/student/exams'),
      api<{ history: HistoryRow[] }>('/student/history')
    ])
      .then(([a, b]) => {
        setExams(a.exams);
        setHistory(b.history);
      })
      .catch((err: Error) => push({ kind: 'error', title: 'Could not load your lobby', body: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function join(target?: string) {
    const value = (target ?? code).trim().toUpperCase();
    if (!value) return;
    setJoining(true);
    try {
      const res = await api<{ exam: { code: string } }>('/student/join', { method: 'POST', body: { code: value } });
      router.push(`/student/exam/${res.exam.code}`);
    } catch (err) {
      push({ kind: 'error', title: 'Could not join', body: err instanceof ApiError ? err.message : 'Check the code' });
    } finally {
      setJoining(false);
    }
  }

  const totals = history.reduce(
    (acc, row) => ({
      points: acc.points + row.points,
      answered: acc.answered + row.answered,
      correct: acc.correct + row.correct,
      bestRank: Math.min(acc.bestRank, row.rank ?? 99)
    }),
    { points: 0, answered: 0, correct: 0, bestRank: 99 }
  );
  const accuracy = totals.answered ? Math.round((totals.correct / totals.answered) * 100) : 0;
  const liveExams = (exams ?? []).filter((e) => e.status === 'live');

  return (
    <StudentShell>
      <div className="space-y-5">
        {/* greeting */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-[1.8rem] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[2.1rem]">
              Hello, {user?.name.split(' ')[0]}.
              {liveExams.length > 0 ? (
                <>
                  {' '}
                  <span className="font-display italic text-lime-300">
                    {liveExams.length} session{liveExams.length > 1 ? 's' : ''} live.
                  </span>
                </>
              ) : (
                <span className="text-white/35"> Nothing live right now.</span>
              )}
            </h1>
            <p className="mt-2 text-[13px] text-white/40">{user?.org}</p>
          </div>
          <Badge tone="violet">
            <Award className="h-3 w-3" /> {history.length} sessions attended
          </Badge>
        </div>

        {/* join strip */}
        <Panel className="relative overflow-hidden p-5 sm:p-6">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-lime-400/10 blur-3xl" />
          <div className="grid items-center gap-5 lg:grid-cols-[1.15fr_1fr]">
            <div>
              <p className="eyebrow mb-2">Join a session</p>
              <h2 className="text-[1.15rem] font-semibold text-white">Enter the code your faculty shared</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/40">
                The question appears the instant it is pushed — with a timer synced to the server, not your device.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="relative min-w-[180px] flex-1">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && join()}
                    placeholder="EXAM CODE"
                    maxLength={8}
                    className="pl-9 font-mono text-[15px] tracking-[0.3em]"
                  />
                </div>
                <Button variant="lime" onClick={() => join()} loading={joining} disabled={!code.trim()}>
                  Join room <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Total points" value={totals.points} hint="across all sessions" tone="lime" icon={<TrendingUp className="h-3.5 w-3.5" />} />
              <Stat label="Accuracy" value={`${accuracy}%`} hint={`${totals.correct}/${totals.answered} correct`} tone="mint" icon={<Target className="h-3.5 w-3.5" />} />
              <Stat label="Best rank" value={totals.bestRank === 99 ? '—' : `#${totals.bestRank}`} hint="in a live cohort" tone="violet" icon={<Award className="h-3.5 w-3.5" />} />
              <Stat label="Sessions" value={history.length} hint="attended" tone="sky" icon={<BookOpen className="h-3.5 w-3.5" />} />
            </div>
          </div>
        </Panel>

        {/* open sessions */}
        <div>
          <SectionHead
            eyebrow="Your rooms"
            title="Open sessions"
            sub="Live sessions jump straight into the exam window. Ended sessions are read-only."
            action={<Badge tone="lime" dot>{liveExams.length} live</Badge>}
          />
          <div className="mt-4">
            {!exams ? (
              <Panel className="p-6">
                <Loading label="Loading sessions" />
              </Panel>
            ) : exams.length === 0 ? (
              <EmptyState
                icon={<Radio className="h-5 w-5" />}
                title="No sessions available yet"
                body="As soon as faculty publishes a session, it will appear here with a join code."
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {exams.map((exam) => (
                  <Panel key={exam.id} hover className="group p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={exam.status} />
                          <span className="rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[10.5px] tracking-[0.12em] text-white/50">
                            {exam.code}
                          </span>
                        </div>
                        <h3 className="mt-2 truncate text-[14.5px] font-semibold text-white">{exam.title}</h3>
                        <p className="mt-0.5 text-[11.5px] text-white/35">
                          {exam.subject} · {exam.totalQuestions} questions · {exam.adminName}
                        </p>
                      </div>
                      <BarChart3 className="h-4 w-4 shrink-0 text-white/15" />
                    </div>
                    <div className="mt-4 flex gap-2">
                      {exam.status === 'live' ? (
                        <Button size="sm" variant="lime" className="flex-1" onClick={() => join(exam.code)}>
                          Enter exam <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Link
                          href={`/student/exam/${exam.code}`}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12.5px] text-white/60 transition hover:border-white/25 hover:text-white"
                        >
                          View result <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  </Panel>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* history */}
        <Panel className="p-5">
          <SectionHead eyebrow="History" title="Your performance" sub="Rank is computed across everyone who answered the same session." />
          <div className="mt-4">
            {history.length === 0 ? (
              <p className="py-8 text-center text-[12.5px] text-white/30">
                Nothing here yet — your first session will populate this table.
              </p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-[10px] uppercase tracking-[0.14em] text-white/30">
                      <th className="px-1 pb-2 font-medium">Session</th>
                      <th className="px-1 pb-2 font-medium">Status</th>
                      <th className="px-1 pb-2 text-right font-medium">Score</th>
                      <th className="px-1 pb-2 text-right font-medium">Correct</th>
                      <th className="px-1 pb-2 text-right font-medium">Rank</th>
                      <th className="px-1 pb-2 text-right font-medium">Avg time</th>
                      <th className="px-1 pb-2 text-right font-medium">Last answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.examId} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-1 py-3">
                          <p className="text-[12.5px] font-medium text-white/85">{row.title}</p>
                          <p className="text-[10.5px] text-white/30">{row.subject}</p>
                        </td>
                        <td className="px-1 py-3">
                          <StatusPill status={row.status} />
                        </td>
                        <td className="num px-1 py-3 text-right text-[12.5px] text-white">
                          {row.points}
                          <span className="text-white/25">/{row.maxPoints}</span>
                        </td>
                        <td className="num px-1 py-3 text-right text-[12.5px] text-mint-300">{row.correct}</td>
                        <td className="num px-1 py-3 text-right text-[12.5px] text-white/70">
                          {row.rank ? `#${row.rank}` : '—'}
                          <span className="text-white/25">/{row.cohort}</span>
                        </td>
                        <td className="num px-1 py-3 text-right text-[12px] text-white/50">
                          <span className="inline-flex items-center gap-1">
                            <Timer className="h-3 w-3 text-white/20" />
                            {fmtMs(row.avgLatencyMs)}
                          </span>
                        </td>
                        <td className="px-1 py-3 text-right text-[11px] text-white/35">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {fmtRelative(row.lastAt)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </StudentShell>
  );
}
