'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, PenLine, Radio, Search, Trash2 } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { DeleteSessionsDialog, sessionFromRow } from '@/components/admin/DeleteSessionsDialog';
import { SessionSettingsDialog } from '@/components/admin/SessionSettingsDialog';
import { Badge, EmptyState, Panel, SectionHead } from '@/components/ui/Panel';
import { Button, LinkButton } from '@/components/ui/Button';
import { Input, SegmentedControl } from '@/components/ui/Field';
import { Loading, StatusPill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, cx } from '@/lib/api';
import type { AdminExamRow } from '@shared/types';

const iconButton =
  'focus-ring relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-900/60 text-white/50 transition hover:border-white/25 hover:text-white';

export default function AnalyticsIndexPage() {
  const { push } = useToast();
  const [exams, setExams] = useState<AdminExamRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'draft' | 'ended'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [editTarget, setEditTarget] = useState<AdminExamRow | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<AdminExamRow[]>([]);

  const load = async () => {
    try {
      const res = await api<{ exams: AdminExamRow[] }>('/exams');
      setExams(res.exams);
      setSelected((prev) => prev.filter((id) => res.exams.some((e) => e.id === id)));
    } catch (err) {
      push({ kind: 'error', title: 'Could not load analytics', body: (err as Error).message });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = (exams ?? []).filter((exam) => {
    const s = search.trim().toLowerCase();
    const matches =
      !s || exam.title.toLowerCase().includes(s) || exam.subject.toLowerCase().includes(s) || exam.code.toLowerCase().includes(s);
    return matches && (statusFilter === 'all' || exam.status === statusFilter);
  });
  const statusCount = (status: 'live' | 'draft' | 'ended') => (exams ?? []).filter((e) => e.status === status).length;
  const selectedExams = useMemo(() => (exams ?? []).filter((e) => selected.includes(e.id)), [exams, selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.includes(e.id));

  function toggleSelected(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAllVisible() {
    setSelected((prev) =>
      allVisibleSelected
        ? prev.filter((id) => !visible.some((e) => e.id === id))
        : [...prev, ...visible.map((e) => e.id).filter((id) => !prev.includes(id))]
    );
  }

  function afterDelete(ids: string[]) {
    setExams((prev) => (prev ? prev.filter((e) => !ids.includes(e.id)) : prev));
    setSelected((prev) => prev.filter((id) => !ids.includes(id)));
    void load();
  }

  return (
    <AdminShell
      title="Analytics"
      subtitle="Per-session accuracy, latency and question-level diagnostics"
      action={
        <LinkButton href="/admin/exams" variant="secondary" size="sm">
          <Radio className="h-3.5 w-3.5" /> Sessions
        </LinkButton>
      }
    >
      {!exams ? (
        <Panel className="p-6">
          <Loading label="Loading reports" />
        </Panel>
      ) : exams.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="No reports yet"
          body="Analytics unlock as soon as a session captures its first response."
        />
      ) : (
        <div className="space-y-4">
          <SectionHead
            eyebrow="Reports"
            title="Pick a session"
            sub="Live sessions update in near real time; ended sessions are frozen snapshots. Edit a report's name, or delete sessions you no longer need."
          />

          <Panel className="flex flex-wrap items-center gap-2.5 p-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title, subject or join code…"
                aria-label="Search reports"
                className="pl-9"
              />
            </div>
            <SegmentedControl
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: `All (${exams.length})` },
                { value: 'live', label: `Live (${statusCount('live')})` },
                { value: 'draft', label: `Draft (${statusCount('draft')})` },
                { value: 'ended', label: `Ended (${statusCount('ended')})` }
              ]}
            />
            {visible.length > 0 && (
              <label className="flex w-full cursor-pointer items-center gap-2.5 px-1 pt-1 text-[13px] text-white/60">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-[#DFB873]"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Select every report in this view"
                />
                Select all {visible.length} in view
                {selected.length > 0 && <span className="text-white/45">· {selected.length} selected</span>}
              </label>
            )}
          </Panel>

          {visible.length === 0 ? (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title="No reports match"
              body="Try another status or clear the search."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((exam) => {
                const isSelected = selected.includes(exam.id);
                return (
                  <div
                    key={exam.id}
                    className={cx(
                      'panel group relative p-5 transition hover:border-royal-400/30 hover:bg-white/[0.045]',
                      isSelected && 'border-royal-400/40 bg-royal-500/[0.06]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="relative z-10 flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-[#DFB873]"
                          checked={isSelected}
                          onChange={() => toggleSelected(exam.id)}
                          aria-label={`Select report: ${exam.title}`}
                        />
                        <StatusPill status={exam.status} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditTarget(exam)}
                          className={iconButton}
                          aria-label={`Edit session: ${exam.title}`}
                          title="Edit session"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTargets([exam])}
                          className={cx(iconButton, 'hover:border-ember-500/45 hover:text-ember-300')}
                          aria-label={`Delete session: ${exam.title}`}
                          title="Delete session"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <ArrowUpRight className="ml-1 h-4 w-4 text-white/20 transition group-hover:text-gold-300" aria-hidden="true" />
                      </div>
                    </div>
                    <h3 className="mt-3 line-clamp-2 font-display text-[19px] font-medium leading-snug text-white">
                      {/* The whole card opens the report; the controls above sit on top of this link. */}
                      <Link
                        href={`/admin/analytics/${exam.id}`}
                        className="focus-ring rounded after:absolute after:inset-0 after:rounded-3xl after:content-['']"
                      >
                        {exam.title}
                      </Link>
                    </h3>
                    <p className="mt-1 text-[12.5px] text-white/50">
                      {exam.subject} · <span className="font-mono tracking-[0.06em]">{exam.code}</span>
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Badge tone="royal">{exam.questionIds.length} Q</Badge>
                      <Badge tone="mint">{exam.participation} students</Badge>
                      <span className="num ml-auto text-[13px] text-white/65">{exam.avgScore} avg pts</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selected.length > 0 && (
            <div className="sticky bottom-4 z-30 mx-auto flex w-full max-w-xl animate-popIn flex-wrap items-center gap-2 rounded-2xl border border-gold-200/20 bg-ink-850/95 p-2.5 shadow-lift backdrop-blur-xl">
              <span className="px-2 text-[13.5px] font-medium text-white">{selected.length} selected</span>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="focus-ring rounded-lg px-2 py-1 text-[12.5px] text-white/55 transition hover:text-white"
              >
                Clear
              </button>
              <Button variant="danger" size="sm" className="ml-auto" onClick={() => setDeleteTargets(selectedExams)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete {selected.length === 1 ? 'session' : `${selected.length} sessions`}
              </Button>
            </div>
          )}
        </div>
      )}

      {editTarget && (
        <SessionSettingsDialog
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          exam={editTarget}
          settings={editTarget.settings}
          onSaved={() => void load()}
        />
      )}

      <DeleteSessionsDialog
        open={deleteTargets.length > 0}
        onClose={() => setDeleteTargets([])}
        sessions={deleteTargets.map(sessionFromRow)}
        onDeleted={afterDelete}
      />
    </AdminShell>
  );
}
