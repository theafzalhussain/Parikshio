'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Database,
  FileUp,
  Layers,
  Plus,
  Radio,
  ServerCog,
  Target,
  Timer,
  Users,
  Zap
} from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { BarChart, Donut, Sparkline } from '@/components/charts/Charts';
import { Badge, Panel, SectionHead, Stat } from '@/components/ui/Panel';
import { LinkButton } from '@/components/ui/Button';
import { Avatar, GradePill, Loading, StatusPill, TypePill } from '@/components/ui/Pills';
import { api, cx, fmtMs, fmtRelative } from '@/lib/api';
import { usePoll } from '@/lib/usePoll';
import type { AdminExamRow, QuestionType } from '@shared/types';

interface OverviewResponse {
  stats: {
    questions: number;
    exams: number;
    liveExams: number;
    students: number;
    responses: number;
    accuracy: number;
    pendingReviews: number;
    aiGraded?: number;
  };
  byType: { type: QuestionType; count: number }[];
  exams: AdminExamRow[];
  recentActivity: {
    id: string;
    studentName: string;
    grade: 'correct' | 'incorrect' | 'pending';
    awarded: number;
    latencyMs: number;
    examTitle: string;
    submittedAt: number;
  }[];
  fastest: { studentName: string; latencyMs: number; examId: string }[];
  infra: { mongo: string; redis: { status: string; keys: number; hits: number; misses: number } };
}

export default function AdminOverview() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<OverviewResponse>('/admin/overview')
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);
  // Pauses while the tab is hidden, refetches the moment it is focused again.
  usePoll(load, 12_000);

  const typeLabels: Record<QuestionType, string> = {
    mcq: 'MCQ',
    truefalse: 'T/F',
    fill: 'Fill',
    short: 'Short',
    long: 'Long'
  };

  return (
    <AdminShell
      title="Control room"
      subtitle="Institute-wide pulse across question bank, live sessions and grading"
      action={
        <div className="flex gap-2">
          <LinkButton href="/admin/exams" variant="secondary" size="sm">
            <Radio className="h-3.5 w-3.5" /> Sessions
          </LinkButton>
          <LinkButton href="/admin/papers" variant="lime" size="sm">
            <FileUp className="h-3.5 w-3.5" /> Upload paper
          </LinkButton>
        </div>
      }
    >
      {!data ? (
        <div className="panel p-6">{error ? <p className="text-[13px] text-ember-400">{error}</p> : <Loading label="Reading the institute pulse" />}</div>
      ) : (
        <div className="space-y-5">
          {/* stats */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Question bank"
              value={data.stats.questions}
              hint={`${data.byType.length} formats in rotation`}
              icon={<Layers className="h-3.5 w-3.5" />}
            />
            <Stat
              label="Live sessions"
              value={data.stats.liveExams}
              hint={`${data.stats.exams} sessions total`}
              tone="lime"
              icon={<Radio className="h-3.5 w-3.5" />}
            />
            <Stat
              label="Responses captured"
              value={data.stats.responses.toLocaleString()}
              hint={`${data.stats.students} enrolled students`}
              tone="mint"
              icon={<Activity className="h-3.5 w-3.5" />}
            />
            <Stat
              label="Cohort accuracy"
              value={`${data.stats.accuracy}%`}
              hint={`${data.stats.pendingReviews} awaiting review · ${data.stats.aiGraded ?? 0} AI-graded`}
              tone="sky"
              icon={<Target className="h-3.5 w-3.5" />}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            {/* sessions */}
            <div className="space-y-4">
              <Panel className="p-5">
                <SectionHead
                  eyebrow="Sessions"
                  title="Delivery queue"
                  sub="Live sessions surface first — open one to push or lock questions."
                  action={
                    <LinkButton href="/admin/exams" variant="ghost" size="sm">
                      View all <ArrowUpRight className="h-3.5 w-3.5" />
                    </LinkButton>
                  }
                />
                <div className="mt-4 space-y-2">
                  {[...data.exams]
                    .sort((a, b) => (a.status === 'live' ? -1 : 1) - (b.status === 'live' ? -1 : 1))
                    .slice(0, 5)
                    .map((exam) => {
                      const progress = exam.questionIds.length
                        ? Math.round((exam.pushedCount / exam.questionIds.length) * 100)
                        : 0;
                      return (
                        <Link
                          key={exam.id}
                          href={`/admin/exams/${exam.id}`}
                          className="group flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 transition hover:border-aurora-400/30 hover:bg-white/[0.04]"
                        >
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-aurora-500/25 to-mint-500/10 text-[11px] font-bold text-white/80 ring-1 ring-inset ring-white/10">
                            {exam.code.slice(0, 2)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-[13.5px] font-medium text-white">{exam.title}</p>
                              <StatusPill status={exam.status} />
                            </div>
                            <p className="mt-1 truncate text-[11.5px] text-white/35">
                              {exam.subject} · {exam.questionIds.length} questions · {exam.participation} students ·{' '}
                              <span className="font-mono">{exam.code}</span>
                            </p>
                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-aurora-400 to-lime-400 transition-all duration-700"
                                style={{ width: `${Math.max(progress, 2)}%` }}
                              />
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="num text-[13px] font-semibold text-white">{exam.avgScore}</p>
                            <p className="text-[10px] uppercase tracking-[0.12em] text-white/30">avg pts</p>
                          </div>
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-white/20 transition group-hover:text-lime-300" />
                        </Link>
                      );
                    })}
                </div>
              </Panel>

              <div className="grid gap-4 sm:grid-cols-2">
                <Panel className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="eyebrow">Question mix</p>
                    <Badge tone="violet">{data.stats.questions} total</Badge>
                  </div>
                  <div className="mt-4">
                    <BarChart
                      height={110}
                      accent="#9E82FF"
                      data={data.byType.map((t) => ({ label: typeLabels[t.type], value: t.count }))}
                    />
                  </div>
                </Panel>

                <Panel className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="eyebrow">Grading health</p>
                    <Badge tone="mint">auto</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-4">
                    <Donut value={data.stats.accuracy} sub="accuracy" size={104} stroke={9} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/30">graded automatically</p>
                        <p className="num text-[13.5px] text-white">
                          {data.stats.responses - data.stats.pendingReviews}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.12em] text-white/30">manual review queue</p>
                        <p className="num text-[13.5px] text-amber-300">{data.stats.pendingReviews}</p>
                      </div>
                      <Sparkline
                        points={[62, 68, 65, 72, 78, 74, 81, 86, 82, data.stats.accuracy]}
                        height={30}
                        stroke="#4FEBAB"
                        fill="rgba(79,235,171,0.16)"
                      />
                    </div>
                  </div>
                </Panel>
              </div>
            </div>

            {/* right rail */}
            <div className="space-y-4">
              <Panel className="p-5">
                <SectionHead eyebrow="Stream" title="Latest submissions" />
                <div className="mt-3 space-y-2.5">
                  {data.recentActivity.length === 0 && (
                    <p className="py-6 text-center text-[12px] text-white/30">No submissions yet.</p>
                  )}
                  {data.recentActivity.slice(0, 6).map((row) => (
                    <div key={row.id} className="flex items-center gap-2.5">
                      <Avatar name={row.studentName} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] text-white/80">{row.studentName}</p>
                        <p className="truncate text-[10.5px] text-white/30">
                          {row.examTitle} · {fmtRelative(row.submittedAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <GradePill grade={row.grade} />
                        <p className="mt-1 text-[10px] text-white/25">{fmtMs(row.latencyMs)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="p-5">
                <SectionHead eyebrow="Speed" title="Fastest correct answers" />
                <div className="mt-3 space-y-2">
                  {data.fastest.length === 0 && <p className="py-4 text-center text-[12px] text-white/30">Nothing graded yet.</p>}
                  {data.fastest.map((row, i) => (
                    <div key={`${row.studentName}-${i}`} className="flex items-center gap-2.5">
                      <span className="num grid h-6 w-6 place-items-center rounded-md bg-lime-400/10 text-[10.5px] font-semibold text-lime-300 ring-1 ring-inset ring-lime-400/25">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-white/70">{row.studentName}</span>
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-white/45">
                        <Timer className="h-3 w-3 text-white/25" />
                        {fmtMs(row.latencyMs)}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="p-5">
                <div className="flex items-center justify-between">
                  <p className="eyebrow">Infrastructure</p>
                  <ServerCog className="h-3.5 w-3.5 text-white/25" />
                </div>
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                    <span className="flex items-center gap-2 text-[12px] text-white/60">
                      <Database className="h-3.5 w-3.5 text-mint-400" /> MongoDB
                    </span>
                    <span className="text-[10.5px] uppercase tracking-[0.1em] text-white/35">{data.infra.mongo}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                    <span className="flex items-center gap-2 text-[12px] text-white/60">
                      <Zap className="h-3.5 w-3.5 text-lime-300" /> Redis cache
                    </span>
                    <span className="text-[10.5px] uppercase tracking-[0.1em] text-white/35">
                      {data.infra.redis.status} · {data.infra.redis.hits}h/{data.infra.redis.misses}m
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                    <span className="flex items-center gap-2 text-[12px] text-white/60">
                      <Users className="h-3.5 w-3.5 text-aurora-300" /> Enrolled students
                    </span>
                    <span className="num text-[12px] text-white/70">{data.stats.students}</span>
                  </div>
                </div>
                <Link
                  href="/admin/analytics"
                  className={cx(
                    'mt-3 flex items-center justify-between rounded-xl border border-aurora-400/25 bg-aurora-500/[0.08] px-3 py-2.5 text-[12px] text-aurora-100 transition',
                    'hover:border-aurora-300/50 hover:bg-aurora-500/[0.14]'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5" /> Open analytics
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Panel>
            </div>
          </div>

          {/* quick formats legend */}
          <Panel className="flex flex-wrap items-center gap-2 p-4">
            <span className="mr-1 text-[11px] uppercase tracking-[0.14em] text-white/30">supported formats</span>
            {(['mcq', 'truefalse', 'fill', 'short', 'long'] as QuestionType[]).map((t) => (
              <TypePill key={t} type={t} />
            ))}
            <span className="ml-auto text-[11px] text-white/25">Timers enforced server-side · late submissions rejected</span>
          </Panel>
        </div>
      )}
    </AdminShell>
  );
}
