'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Clock,
  Flame,
  KeyRound,
  Layers,
  Radio,
  Sparkles,
  Target,
  Timer,
  TrendingUp
} from 'lucide-react';
import { StudentShell } from '@/components/StudentShell';
import { HBar, accuracyColor } from '@/components/charts/Charts';
import { Achievements } from '@/components/student/Achievements';
import { LevelCard } from '@/components/student/LevelCard';
import { CountUp, HorizonGrid, MotionZone, Tilt3D } from '@/components/student/Motion3D';
import { Badge, EmptyState, Panel, SectionHead, Stat } from '@/components/ui/Panel';
import { Button, LinkButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Loading, StatusPill, typeLabel } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, cx, firstName, fmtMs, fmtRelative } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { badgesFor, greetingFor, levelFor } from '@/lib/progress';
import { usePoll } from '@/lib/usePoll';
import type { ExamStatus, QuestionType } from '@shared/types';

interface ExamCard {
  id: string;
  code: string;
  title: string;
  subject: string;
  status: ExamStatus;
  totalQuestions: number;
  adminName: string;
  endedAt?: number;
  openSet: { size: number } | null;
}

interface HistoryRow {
  examId: string;
  title: string;
  subject: string;
  status: ExamStatus;
  code: string;
  answered: number;
  correct: number;
  points: number;
  maxPoints: number;
  rank: number | null;
  cohort: number;
  avgLatencyMs: number;
  lastAt: number;
}

interface Insights {
  totals: { answered: number; correct: number; accuracy: number; pending: number; points: number; avgLatencyMs: number };
  byType: { type: QuestionType; answered: number; correct: number; accuracy: number }[];
  byTopic: { topic: string; answered: number; correct: number; accuracy: number }[];
  bestStreak: number;
}

export default function StudentLobby() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const { push } = useToast();
  const [exams, setExams] = useState<ExamCard[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const failedOnce = useRef(false);
  const joinLinkHandled = useRef(false);

  // Live statuses change while the lobby is open (a teacher starts a session,
  // pushes a set), so it refreshes itself — paused while the tab is hidden.
  const refresh = useCallback(() => {
    Promise.all([
      api<{ exams: ExamCard[] }>('/student/exams'),
      api<{ history: HistoryRow[] }>('/student/history'),
      api<{ insights: Insights }>('/student/insights')
    ])
      .then(([a, b, c]) => {
        setExams(a.exams);
        setHistory(b.history);
        setInsights(c.insights);
        failedOnce.current = false;
      })
      .catch((err: Error) => {
        // One toast per outage, not one every poll.
        if (failedOnce.current) return;
        failedOnce.current = true;
        push({ kind: 'error', title: 'Could not load your lobby', body: err.message });
      });
  }, [push]);
  usePoll(refresh, 15_000);

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

  // `/student?join=CODE` comes from the "Join exam" box on the home page. It
  // is handled once, after sign-in is confirmed, and removed from the address
  // bar so a refresh does not join again.
  useEffect(() => {
    if (!ready || user?.role !== 'student' || joinLinkHandled.current) return;
    joinLinkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('join')?.trim().toUpperCase() ?? '';
    if (!params.has('join')) return;
    params.delete('join');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
    if (!/^[A-Z0-9]{4,10}$/.test(requested)) return;
    setCode(requested);
    void join(requested);
    // `join` is recreated every render; this must run once per page load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

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

  // Levels and badges come from the same graded answers faculty see. History
  // counts every answer; insights count only graded ones (pending reviews and
  // still-sealed questions are left out), which is what accuracy badges need.
  const level = levelFor(totals.points);
  const badges = badgesFor({
    answered: totals.answered,
    graded: insights?.totals.answered ?? 0,
    accuracy: insights?.totals.accuracy ?? accuracy,
    bestStreak: insights?.bestStreak ?? 0,
    avgLatencyMs: insights?.totals.avgLatencyMs ?? 0,
    sessions: history.length,
    bestRank: totals.bestRank === 99 ? null : totals.bestRank,
    points: totals.points,
    formats: insights ? insights.byType.filter((t) => t.answered > 0).length : 0
  });
  const greetName = user ? firstName(user.name) : '';

  return (
    <StudentShell>
      <div className="space-y-7">
        {/* hero: greeting, join box and the 3D level card */}
        <MotionZone>
        <Panel className="gold-edge relative p-5 sm:p-8 lg:p-10">
          {/* Decoration is clipped to the panel; the cube is free to rise past its edge. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
            <div className="aura aura-gold -right-20 -top-24 h-80 w-80" />
            <div className="aura aura-royal -bottom-32 -left-24 h-80 w-80 opacity-70" />
            <HorizonGrid />
          </div>
          <div className="relative grid items-center gap-9 lg:grid-cols-[1.08fr_0.92fr] lg:gap-10 [&>*]:min-w-0">
            <div className="animate-fadeUp">
              <p className="eyebrow eyebrow-rule mb-3">
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <h1 className="font-display text-[2.1rem] font-normal leading-[1.08] text-white sm:text-[2.7rem]">
                {greetingFor(new Date())}, <span className="gold-text italic">{greetName}</span>.
              </h1>
              <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-white/65">
                {liveExams.length > 0 ? (
                  <>
                    <span className="mr-1.5 inline-flex translate-y-[-1px] items-center gap-1.5 rounded-full bg-gold-400/[0.14] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-200 ring-1 ring-inset ring-gold-300/30">
                      <span className="relative flex h-1.5 w-1.5 rounded-full bg-gold-300">
                        <span className="absolute inset-0 animate-ping rounded-full bg-gold-300 opacity-75" />
                      </span>
                      live
                    </span>
                    {liveExams.length === 1
                      ? `${liveExams[0]!.title} is running now.`
                      : `${liveExams.length} sessions are running now.`}{' '}
                    <a href="#rooms" className="focus-ring rounded font-medium text-gold-200 underline-offset-4 hover:underline">
                      Jump in
                    </a>
                  </>
                ) : (
                  'Nothing is live right now. When your teacher starts an exam, enter the code they share here.'
                )}
              </p>
              {user?.org && <p className="mt-2 text-[13.5px] text-white/50">{user.org}</p>}

              <form
                className="mt-7 flex flex-wrap gap-2.5 rounded-2xl border border-white/[0.08] bg-ink-950/50 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void join();
                }}
              >
                <div className="relative min-w-[11rem] flex-1">
                  <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-200/60" />
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="EXAM CODE"
                    maxLength={8}
                    aria-label="Exam code"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="h-12 border-transparent bg-transparent pl-11 font-mono text-[17px] tracking-[0.32em] shadow-none sm:text-[17px]"
                  />
                </div>
                <Button type="submit" variant="gold" size="lg" loading={joining} disabled={!code.trim()} className="grow sm:grow-0">
                  Join room <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
              <p className="mt-3 text-[12.5px] text-white/45">
                The timer runs on the server, so everyone in the room gets exactly the same time.
              </p>
            </div>

            <div className="animate-fadeUp pt-10 [animation-delay:140ms] sm:pt-12 lg:pt-0">
              <LevelCard
                info={level}
                answered={totals.answered}
                accuracy={accuracy}
                bestStreak={insights?.bestStreak ?? 0}
                badgesEarned={badges.filter((b) => b.earned).length}
                badgesTotal={badges.length}
              />
            </div>
          </div>
        </Panel>
        </MotionZone>

        {/* numbers */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: 'Total points',
              value: <CountUp value={totals.points} />,
              hint: 'across all sessions',
              tone: 'gold' as const,
              icon: <TrendingUp className="h-3.5 w-3.5" />
            },
            {
              label: 'Accuracy',
              value: <CountUp value={accuracy} suffix="%" />,
              hint: `${totals.correct}/${totals.answered} correct`,
              tone: 'mint' as const,
              icon: <Target className="h-3.5 w-3.5" />
            },
            {
              label: 'Best rank',
              value: totals.bestRank === 99 ? '—' : <CountUp value={totals.bestRank} prefix="#" duration={700} />,
              hint: 'in a live cohort',
              tone: 'royal' as const,
              icon: <Award className="h-3.5 w-3.5" />
            },
            {
              label: 'Sessions',
              value: <CountUp value={history.length} duration={700} />,
              hint: 'attended',
              tone: 'sky' as const,
              icon: <BookOpen className="h-3.5 w-3.5" />
            }
          ].map((stat, i) => (
            // Fade on the wrapper, tilt on the card: both animate `transform`.
            <div key={stat.label} className="animate-fadeUp" style={{ animationDelay: `${200 + i * 70}ms` }}>
              <Tilt3D max={7} className="h-full rounded-2xl">
                <Stat label={stat.label} value={stat.value} hint={stat.hint} tone={stat.tone} icon={stat.icon} className="h-full" />
              </Tilt3D>
            </div>
          ))}
        </div>

        {/* open sessions */}
        <div id="rooms" className="scroll-mt-24">
          <SectionHead
            eyebrow="Your rooms"
            title="Open sessions"
            sub="Live sessions jump straight into the exam window. Ended sessions show your result."
            action={<Badge tone="gold" dot>{liveExams.length} live</Badge>}
          />
          <div className="mt-5">
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
              <div className="grid gap-4 md:grid-cols-2">
                {exams.map((exam) => (
                  <Tilt3D key={exam.id} max={6} lift={1.01} className="rounded-3xl">
                    <Panel
                      className={cx(
                        'preserve-3d group flex h-full flex-col p-5 sm:p-6',
                        exam.status === 'live' && 'border-gold-300/25 bg-gradient-to-b from-gold-400/[0.06] to-transparent'
                      )}
                    >
                      <div className="preserve-3d flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill status={exam.status} />
                            <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 font-mono text-[12px] tracking-[0.12em] text-white/70">
                              {exam.code}
                            </span>
                          </div>
                          <h3 className="mt-3 break-words font-display text-[20px] font-medium leading-snug text-white">{exam.title}</h3>
                          <p className="mt-1 text-[13px] text-white/55">
                            {exam.subject} · {exam.totalQuestions} questions · {exam.adminName}
                          </p>
                          {exam.status === 'live' && exam.openSet && (
                            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-gold-300/25 bg-gold-400/[0.08] px-3 py-1 text-[12.5px] text-gold-100">
                              <Layers className="h-3.5 w-3.5 text-gold-300" />
                              {exam.openSet.size} question{exam.openSet.size === 1 ? '' : 's'} waiting · answer in any order
                            </p>
                          )}
                        </div>
                        <span
                          className={cx(
                            'depth-sm grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ring-inset transition',
                            exam.status === 'live'
                              ? 'bg-gold-400/[0.12] text-gold-200 ring-gold-300/35 shadow-[0_12px_30px_-14px_rgba(223,184,115,0.8)]'
                              : 'bg-white/[0.04] text-white/40 ring-white/10 group-hover:text-gold-200 group-hover:ring-gold-300/30'
                          )}
                        >
                          {exam.status === 'live' ? <Radio className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}
                        </span>
                      </div>
                      <div className="mt-auto flex gap-2 pt-5">
                        {exam.status === 'live' ? (
                          <Button size="md" variant="gold" className="flex-1" onClick={() => join(exam.code)}>
                            {exam.openSet ? 'Open question set' : 'Enter exam'} <ArrowRight className="h-4 w-4" />
                          </Button>
                        ) : (
                          <LinkButton href={`/student/exam/${exam.code}`} size="md" variant="secondary" className="flex-1">
                            View result <ArrowRight className="h-4 w-4" />
                          </LinkButton>
                        )}
                      </div>
                    </Panel>
                  </Tilt3D>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* badges */}
        <Achievements badges={badges} />

        {/* insights */}
        {insights && insights.totals.answered > 0 && (
          <Panel className="p-5 sm:p-7">
            <SectionHead
              eyebrow="Insights"
              title="Where you shine — and where to practise"
              sub="Built from every graded answer you have given. Written answers still in review are not counted yet."
              action={
                insights.bestStreak > 1 ? (
                  <Badge tone="gold">
                    <Flame className="h-3 w-3" /> best streak · {insights.bestStreak} in a row
                  </Badge>
                ) : undefined
              }
            />
            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr_0.8fr] [&>*]:min-w-0">
              <div>
                <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">By question format</p>
                <div className="space-y-3.5">
                  {insights.byType.map((row) => (
                    <HBar
                      key={row.type}
                      label={`${typeLabel(row.type)} · ${row.correct}/${row.answered}`}
                      value={row.accuracy}
                      max={100}
                      suffix="%"
                      accent={accuracyColor(row.accuracy)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">By topic</p>
                <div className="space-y-3.5">
                  {insights.byTopic.map((row) => (
                    <HBar
                      key={row.topic}
                      label={`${row.topic} · ${row.correct}/${row.answered}`}
                      value={row.accuracy}
                      max={100}
                      suffix="%"
                      accent={accuracyColor(row.accuracy)}
                    />
                  ))}
                </div>
              </div>
              <div className="grid content-start gap-3">
                {(() => {
                  const strongest = [...insights.byTopic].filter((t) => t.answered >= 1).sort((a, b) => b.accuracy - a.accuracy)[0];
                  const weakest = [...insights.byTopic].filter((t) => t.answered >= 1).sort((a, b) => a.accuracy - b.accuracy)[0];
                  return (
                    <>
                      {strongest && (
                        <div className="rounded-2xl border border-mint-400/20 bg-mint-500/[0.05] p-4">
                          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-mint-300">
                            <Sparkles className="h-3.5 w-3.5" /> Strongest topic
                          </p>
                          <p className="mt-1.5 font-display text-[18px] text-white">{strongest.topic}</p>
                          <p className="text-[12.5px] text-white/55">{strongest.accuracy}% accuracy</p>
                        </div>
                      )}
                      {weakest && weakest.topic !== strongest?.topic && (
                        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
                          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-amber-200">
                            <Target className="h-3.5 w-3.5" /> Practise next
                          </p>
                          <p className="mt-1.5 font-display text-[18px] text-white">{weakest.topic}</p>
                          <p className="text-[12.5px] text-white/55">{weakest.accuracy}% accuracy</p>
                        </div>
                      )}
                      <div className="rounded-2xl border border-white/[0.08] bg-ink-950/40 p-4">
                        <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-white/55">
                          <Timer className="h-3.5 w-3.5" /> Average answer time
                        </p>
                        <p className="num mt-1.5 text-[20px] font-semibold text-white">{fmtMs(insights.totals.avgLatencyMs)}</p>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </Panel>
        )}

        {/* history */}
        <Panel className="p-5 sm:p-7">
          <SectionHead eyebrow="History" title="Your performance" sub="Rank is computed across everyone who answered the same session." />
          <div className="mt-5">
            {history.length === 0 ? (
              <p className="py-8 text-center text-[13.5px] text-white/55">
                Nothing here yet — your first session will populate this table.
              </p>
            ) : (
              <div className="-mx-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-[11px] uppercase tracking-[0.14em] text-white/45">
                      <th className="px-3 pb-3 font-medium">Session</th>
                      <th className="px-3 pb-3 font-medium">Status</th>
                      <th className="px-3 pb-3 text-right font-medium">Score</th>
                      <th className="px-3 pb-3 text-right font-medium">Correct</th>
                      <th className="px-3 pb-3 text-right font-medium">Rank</th>
                      <th className="px-3 pb-3 text-right font-medium">Avg time</th>
                      <th className="px-3 pb-3 text-right font-medium">Last answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.examId} className="border-b border-white/[0.05] transition last:border-0 hover:bg-white/[0.025]">
                        <td className="px-3 py-3.5">
                          {row.code ? (
                            <a
                              href={`/student/exam/${row.code}`}
                              className="focus-ring rounded text-[13.5px] font-medium text-white/85 underline-offset-4 transition hover:text-gold-200 hover:underline"
                            >
                              {row.title}
                            </a>
                          ) : (
                            <p className="text-[13.5px] font-medium text-white/85">{row.title}</p>
                          )}
                          <p className="text-[11.5px] text-white/45">{row.subject}</p>
                        </td>
                        <td className="px-3 py-3.5">
                          <StatusPill status={row.status} />
                        </td>
                        <td className="num px-3 py-3.5 text-right text-[13.5px] text-white">
                          {row.points}
                          <span className="text-white/40">/{row.maxPoints}</span>
                        </td>
                        <td className="num px-3 py-3.5 text-right text-[13.5px] text-mint-300">{row.correct}</td>
                        <td className="num px-3 py-3.5 text-right text-[13.5px] text-white/80">
                          {row.rank ? `#${row.rank}` : '—'}
                          <span className="text-white/40">/{row.cohort}</span>
                        </td>
                        <td className="num px-3 py-3.5 text-right text-[13px] text-white/65">
                          <span className="inline-flex items-center gap-1">
                            <Timer className="h-3 w-3 text-white/20" />
                            {fmtMs(row.avgLatencyMs)}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-right text-[12px] text-white/50">
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
