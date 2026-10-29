'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ArrowLeft, BarChart3, Check, Download, Gauge, PenLine, Target, Timer, Trash2, Users, Zap } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { DeleteSessionsDialog } from '@/components/admin/DeleteSessionsDialog';
import { SessionSettingsDialog } from '@/components/admin/SessionSettingsDialog';
import { BarChart, Donut, HBar, accuracyColor, chartColors } from '@/components/charts/Charts';
import { Badge, EmptyState, Panel, SectionHead, Stat } from '@/components/ui/Panel';
import { Button, LinkButton } from '@/components/ui/Button';
import { Loading, StatusPill, TypePill, typeLabel } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, cx, fmtMs } from '@/lib/api';
import { usePoll } from '@/lib/usePoll';
import type { Analytics, Exam, ExamSettings } from '@shared/types';

export default function AnalyticsDetailPage() {
  const params = useParams<{ id: string }>();
  const examId = params?.id ?? '';
  const router = useRouter();
  const { push } = useToast();
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [live, setLive] = useState(false);
  const [editing, setEditing] = useState<{ exam: Exam; settings: ExamSettings } | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(() => {
    api<{ analytics: Analytics }>(`/exams/${examId}/analytics`)
      .then((res) => {
        setData(res.analytics);
        setLive(res.analytics.status === 'live');
      })
      .catch((err: Error) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        setError(err.message);
      });
  }, [examId]);
  // Pauses while the tab is hidden, refetches the moment it is focused again.
  usePoll(load, 15_000, !missing);

  async function openEdit() {
    setEditLoading(true);
    try {
      const res = await api<{ exam: Exam; settings: ExamSettings }>(`/exams/${examId}`);
      setEditing({ exam: res.exam, settings: res.settings });
    } catch (err) {
      push({ kind: 'error', title: 'Could not open the session', body: (err as Error).message });
    } finally {
      setEditLoading(false);
    }
  }

  function exportCsv() {
    if (!data) return;
    const rows = [
      ['Question', 'Type', 'Points', 'Attempts', 'Correct', 'Pending', 'Accuracy %', 'Avg latency ms'],
      ...data.questionStats.map((q) => [
        `"${q.prompt.replace(/"/g, "'")}"`,
        q.type,
        String(q.points),
        String(q.attempts),
        String(q.correct),
        String(q.pending),
        String(q.accuracy),
        String(q.avgLatencyMs)
      ])
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parikshio-analytics-${examId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    push({ kind: 'success', title: 'Report exported', body: 'CSV downloaded with per-question diagnostics.' });
  }

  return (
    <AdminShell
      title={data ? data.title : 'Session analytics'}
      subtitle={data ? `${data.subject} · ${data.responses} responses across ${data.participants} students` : undefined}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {data && <StatusPill status={data.status} />}
          <Button size="sm" variant="secondary" onClick={() => void openEdit()} loading={editLoading} disabled={!data}>
            <PenLine className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!data}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-white/60 hover:text-ember-300"
            onClick={() => setDeleteOpen(true)}
            disabled={!data}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      }
    >
      {missing ? (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="This report no longer exists"
          body="The session may have been deleted. Its questions are still in your question bank."
          action={
            <LinkButton href="/admin/analytics" size="sm" variant="secondary">
              <ArrowLeft className="h-3.5 w-3.5" /> All reports
            </LinkButton>
          }
        />
      ) : !data ? (
        <Panel className="p-6">
          {error ? <p className="text-[14px] text-ember-400">{error}</p> : <Loading label="Crunching responses" />}
        </Panel>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/admin/analytics" className="inline-flex items-center gap-1.5 text-[13px] text-white/55 hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> All reports
            </Link>
            <div className="flex items-center gap-2">
              {live && <Badge tone="gold" dot>auto-refreshing</Badge>}
              <LinkButton href={`/admin/exams/${examId}`} variant="ghost" size="sm">
                Open control room
              </LinkButton>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Accuracy" value={`${data.accuracy}%`} hint="objective + keyed answers" tone="gold" icon={<Target className="h-3.5 w-3.5" />} />
            <Stat label="Avg score" value={`${data.avgScore}/${data.maxPossible}`} hint="per student, total points" tone="royal" icon={<BarChart3 className="h-3.5 w-3.5" />} />
            <Stat label="Avg latency" value={fmtMs(data.avgLatencyMs)} hint="push → submit" tone="sky" icon={<Timer className="h-3.5 w-3.5" />} />
            <Stat label="Completion" value={`${data.completionRate}%`} hint={`${data.responses} answers captured`} tone="mint" icon={<Check className="h-3.5 w-3.5" />} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <Panel className="p-5">
              <SectionHead eyebrow="Diagnostics" title="Question-level performance" sub="Accuracy excludes responses still awaiting manual review." />
              <div className="mt-4 space-y-3.5">
                {data.questionStats.map((q, i) => (
                  q.attempts === 0 ? (
                    <div
                      key={q.questionId}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.012] px-3 py-2.5"
                    >
                      <span className="num grid h-5 w-5 place-items-center rounded-md bg-white/[0.05] text-[11px] text-white/50">
                        {i + 1}
                      </span>
                      <TypePill type={q.type} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-white/50">{q.prompt}</span>
                      <Badge tone="neutral">not pushed yet</Badge>
                    </div>
                  ) : (
                  <div key={q.questionId} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="num grid h-5 w-5 place-items-center rounded-md bg-white/[0.06] text-[11px] text-white/55">
                            {i + 1}
                          </span>
                          <TypePill type={q.type} />
                          <span className="num text-[11.5px] text-white/45">{q.points} pts</span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-white/75">{q.prompt}</p>
                      </div>
                      <div className="text-right">
                        <p
                          className={cx(
                            'num text-[15px] font-semibold',
                            q.accuracy >= 70 ? 'text-mint-300' : q.accuracy >= 40 ? 'text-amber-300' : 'text-ember-400'
                          )}
                        >
                          {q.accuracy}%
                        </p>
                        <p className="text-[10.5px] uppercase tracking-[0.1em] text-white/45">accuracy</p>
                      </div>
                    </div>

                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[11px] text-white/45">
                          <span>correct / attempts</span>
                          <span className="num">
                            {q.correct}/{q.attempts}
                            {q.pending > 0 && <span className="text-amber-300/80"> · {q.pending} to review</span>}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-mint-500/60 to-mint-400 transition-all duration-700"
                            style={{ width: `${Math.max(q.accuracy, 2)}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[11px] text-white/45">
                          <span>avg latency</span>
                          <span className="num">{fmtMs(q.avgLatencyMs)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-royal-500/60 to-royal-300"
                            style={{ width: `${Math.min(100, (q.avgLatencyMs / Math.max(data.avgLatencyMs * 1.8, 1000)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {q.optionDistribution && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <span className="text-[10.5px] uppercase tracking-[0.1em] text-white/40">options</span>
                        <div className="flex flex-1 gap-1">
                          {q.optionDistribution.map((count, oi) => {
                            const maxCount = Math.max(...(q.optionDistribution ?? [1]), 1);
                            return (
                              <div key={oi} className="flex-1">
                                <div className="h-1.5 overflow-hidden rounded bg-white/[0.05]">
                                  <div
                                    className="h-full rounded bg-white/25"
                                    style={{ width: `${(count / maxCount) * 100}%` }}
                                  />
                                </div>
                                <p className="num mt-0.5 text-center text-[10px] text-white/40">
                                  {String.fromCharCode(65 + oi)}·{count}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  )
                ))}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel className="p-5">
                <p className="eyebrow">Cohort</p>
                <div className="mt-4 flex items-center justify-around">
                  <Donut value={data.accuracy} sub="accuracy" />
                  <div className="space-y-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/45">participants</p>
                      <p className="num flex items-center gap-1.5 text-[16px] font-semibold text-white">
                        <Users className="h-3.5 w-3.5 text-royal-300" /> {data.participants}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-white/45">responses</p>
                      <p className="num flex items-center gap-1.5 text-[16px] font-semibold text-white">
                        <Zap className="h-3.5 w-3.5 text-gold-300" /> {data.responses}
                      </p>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel className="p-5">
                <p className="eyebrow">Response speed</p>
                <p className="mt-1 text-[12px] text-white/50">How fast answers arrived after each push.</p>
                <div className="mt-3">
                  <BarChart
                    height={120}
                    accent={chartColors.mint}
                    data={data.latencyBuckets.map((b) => ({ label: b.label, value: b.count }))}
                  />
                </div>
              </Panel>

              <Panel className="p-5">
                <p className="eyebrow">Format strength</p>
                <div className="mt-3 space-y-3">
                  {data.typeStats.map((t) => (
                    <HBar
                      key={t.type}
                      label={typeLabel(t.type)}
                      value={t.accuracy}
                      max={100}
                      suffix="%"
                      accent={accuracyColor(t.accuracy)}
                    />
                  ))}
                  {data.typeStats.length === 0 && <p className="text-[13px] text-white/45">No responses yet.</p>}
                </div>
              </Panel>

              <Panel className="p-5">
                <p className="eyebrow">Top performers</p>
                <div className="mt-3 space-y-2">
                  {data.topPerformers.map((p) => (
                    <div key={p.studentId} className="flex items-center gap-2.5">
                      <span className="num grid h-6 w-6 place-items-center rounded-md bg-gold-400/10 text-[11.5px] font-semibold text-gold-300 ring-1 ring-inset ring-gold-400/25">
                        {p.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-white/75">{p.name}</span>
                      <span className="num text-[12.5px] text-white/60">{p.points} pts</span>
                      <span className="num text-[11.5px] text-white/40">{fmtMs(p.avgLatencyMs)}</span>
                    </div>
                  ))}
                  {data.topPerformers.length === 0 && <p className="text-[13px] text-white/45">No scores yet.</p>}
                </div>
              </Panel>

              <Panel className="p-5">
                <div className="flex items-center justify-between">
                  <p className="eyebrow">Insight</p>
                  <Gauge className="h-3.5 w-3.5 text-white/40" />
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-white/65">
                  {insight(data)}
                </p>
              </Panel>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <SessionSettingsDialog
          open={!!editing}
          onClose={() => setEditing(null)}
          exam={editing.exam}
          settings={editing.settings}
          onSaved={load}
        />
      )}

      {data && (
        <DeleteSessionsDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          sessions={[
            {
              id: examId,
              title: data.title,
              status: data.status,
              students: data.participants,
              answers: data.responses
            }
          ]}
          onDeleted={() => router.replace('/admin/analytics')}
        />
      )}
    </AdminShell>
  );
}

function insight(data: Analytics): string {
  if (!data.questionStats.length) return 'Push the first question to start generating diagnostics.';
  const attempted = data.questionStats.filter((q) => q.attempts > 0);
  if (!attempted.length) return 'Questions are queued but nothing has been answered yet — push one to start collecting diagnostics.';
  const weakest = [...attempted].sort((a, b) => a.accuracy - b.accuracy)[0];
  const fastest = [...data.typeStats].sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];
  const parts = [
    `Weakest item is ${typeLabel(weakest.type).toLowerCase()} at ${weakest.accuracy}% accuracy (${weakest.attempts} attempts).`
  ];
  if (fastest) parts.push(`${typeLabel(fastest.type)} answers arrived fastest at ${fmtMs(fastest.avgLatencyMs)}.`);
  if (data.completionRate < 80 && data.status === 'ended')
    parts.push(`Completion was ${data.completionRate}% — some students left items blank.`);
  return parts.join(' ');
}
