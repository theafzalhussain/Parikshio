'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Copy, Layers, PenLine, Plus, Radio, Search, Timer, Trash2, Users } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { DeleteSessionsDialog, sessionFromRow } from '@/components/admin/DeleteSessionsDialog';
import { SessionSettingsDialog } from '@/components/admin/SessionSettingsDialog';
import { Badge, EmptyState, Panel } from '@/components/ui/Panel';
import { Button, LinkButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { GroupLabel, Input, Label, SegmentedControl } from '@/components/ui/Field';
import { Loading, StatusPill, TypePill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, cx } from '@/lib/api';
import type { AdminExamRow, Question } from '@shared/types';

const iconButton =
  'focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-white/50 transition hover:border-white/25 hover:text-white';

export default function ExamsPage() {
  const { push } = useToast();
  const [exams, setExams] = useState<AdminExamRow[] | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'draft' | 'ended'>('all');
  const [pickerSearch, setPickerSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editTarget, setEditTarget] = useState<AdminExamRow | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<AdminExamRow[]>([]);

  const load = async () => {
    try {
      const [examRes, qRes] = await Promise.all([
        api<{ exams: AdminExamRow[] }>('/exams'),
        api<{ questions: Question[] }>('/questions')
      ]);
      setExams(examRes.exams);
      setQuestions(qRes.questions);
      // Forget selections for sessions that no longer exist.
      setSelected((prev) => prev.filter((id) => examRes.exams.some((e) => e.id === id)));
    } catch (err) {
      push({ kind: 'error', title: 'Could not load sessions', body: (err as Error).message });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelected(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ exam: { id: string; code: string } }>('/exams', {
        method: 'POST',
        body: { title, subject, questionIds: picked }
      });
      push({ kind: 'success', title: 'Session created', body: `Join code ${res.exam.code} is live for students.` });
      setOpen(false);
      setTitle('');
      setSubject('');
      setPicked([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the session');
    } finally {
      setBusy(false);
    }
  }

  const orderedQuestions = [...questions].sort((a, b) => b.createdAt - a.createdAt);
  const pickerRows = orderedQuestions.filter((q) => {
    const s = pickerSearch.trim().toLowerCase();
    return !s || q.prompt.toLowerCase().includes(s) || q.topic.toLowerCase().includes(s);
  });
  const visibleExams = (exams ?? []).filter((exam) => {
    const s = search.trim().toLowerCase();
    const matchesSearch =
      !s || exam.title.toLowerCase().includes(s) || exam.subject.toLowerCase().includes(s) || exam.code.toLowerCase().includes(s);
    return matchesSearch && (statusFilter === 'all' || exam.status === statusFilter);
  });
  const statusCount = (status: 'live' | 'draft' | 'ended') => (exams ?? []).filter((e) => e.status === status).length;
  const selectedExams = useMemo(() => (exams ?? []).filter((e) => selected.includes(e.id)), [exams, selected]);
  const allVisibleSelected = visibleExams.length > 0 && visibleExams.every((e) => selected.includes(e.id));

  function toggleAllVisible() {
    setSelected((prev) =>
      allVisibleSelected
        ? prev.filter((id) => !visibleExams.some((e) => e.id === id))
        : [...prev, ...visibleExams.map((e) => e.id).filter((id) => !prev.includes(id))]
    );
  }

  function afterDelete(ids: string[]) {
    setExams((prev) => (prev ? prev.filter((e) => !ids.includes(e.id)) : prev));
    setSelected((prev) => prev.filter((id) => !ids.includes(id)));
    void load();
  }

  return (
    <AdminShell
      title="Live sessions"
      subtitle="Create a session, then push one question to everyone or several as a self-paced set"
      action={
        <Button size="sm" variant="gold" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New session
        </Button>
      }
    >
      <div className="space-y-4">
        {exams && exams.length > 0 && (
          <Panel className="flex flex-wrap items-center gap-2.5 p-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title, subject or join code…"
                aria-label="Search sessions"
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
            {visibleExams.length > 0 && (
              <label className="flex w-full cursor-pointer items-center gap-2.5 px-1 pt-1 text-[13px] text-white/60">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-[#DFB873]"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Select every session in this view"
                />
                Select all {visibleExams.length} in view
                {selected.length > 0 && <span className="text-white/45">· {selected.length} selected</span>}
              </label>
            )}
          </Panel>
        )}
        {!exams ? (
          <Panel className="p-6">
            <Loading label="Loading sessions" />
          </Panel>
        ) : exams.length === 0 ? (
          <EmptyState
            icon={<Radio className="h-5 w-5" />}
            title="No sessions yet"
            body="Create a session, attach questions from the bank, and you are one click from going live."
            action={
              <Button size="sm" variant="gold" onClick={() => setOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Create session
              </Button>
            }
          />
        ) : visibleExams.length === 0 ? (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title="No sessions match"
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
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleExams.map((exam) => {
              const progress = exam.questionIds.length
                ? Math.round((exam.pushedCount / exam.questionIds.length) * 100)
                : 0;
              return (
                <Panel
                  key={exam.id}
                  hover
                  className={cx('overflow-hidden p-5', selected.includes(exam.id) && 'border-royal-400/40 bg-royal-500/[0.06]')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer accent-[#DFB873]"
                        checked={selected.includes(exam.id)}
                        onChange={() => toggleSelected(exam.id)}
                        aria-label={`Select session: ${exam.title}`}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={exam.status} />
                          <span className="rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[11.5px] tracking-[0.1em] text-white/65">
                            {exam.code}
                          </span>
                          {exam.set && !exam.set.closed && (
                            <Badge tone="gold">
                              <Layers className="h-3 w-3" /> set · {exam.set.items.length}
                            </Badge>
                          )}
                        </div>
                        <h3 className="mt-2.5 truncate font-display text-[20px] font-medium text-white">{exam.title}</h3>
                        <p className="mt-0.5 truncate text-[12.5px] text-white/50">
                          {exam.subject} · {exam.adminName}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(exam.code);
                          push({ kind: 'info', title: 'Join code copied', body: exam.code });
                        }}
                        className={iconButton}
                        aria-label={`Copy join code ${exam.code}`}
                        title="Copy join code"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
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
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      { icon: Radio, label: 'questions', value: exam.questionIds.length },
                      { icon: Users, label: 'students', value: exam.participation },
                      { icon: BarChart3, label: 'avg pts', value: exam.avgScore }
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
                        <s.icon className="h-3.5 w-3.5 text-white/40" />
                        <p className="num mt-1.5 text-[14px] font-semibold text-white">{s.value}</p>
                        <p className="text-[10.5px] uppercase tracking-[0.12em] text-white/45">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-[11.5px] text-white/45">
                      <span>delivery progress</span>
                      <span className="num">{progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-royal-400 to-gold-400 transition-all duration-700"
                        style={{ width: `${Math.max(progress, 2)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <LinkButton href={`/admin/exams/${exam.id}`} size="sm" variant={exam.status === 'live' ? 'gold' : 'secondary'} className="flex-1">
                      <Radio className="h-3.5 w-3.5" />
                      {exam.status === 'live' ? 'Open control room' : 'Open session'}
                    </LinkButton>
                    <LinkButton href={`/admin/analytics/${exam.id}`} size="sm" variant="ghost">
                      <BarChart3 className="h-3.5 w-3.5" /> Analytics
                    </LinkButton>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}

        {/* Bulk actions, pinned to the bottom edge so they stay within thumb reach on phones. */}
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a live session"
        description="Give it a title, then pick the questions you want queued. You can push them one at a time from the control room."
        width="max-w-3xl"
        footer={
          <>
            <span className="mr-auto text-[12.5px] text-white/50">{picked.length} selected</span>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="gold" size="sm" loading={busy} onClick={create} disabled={!title.trim() || picked.length === 0}>
              Create session
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="exam-title">Session title</Label>
              <Input
                id="exam-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Unit 4 — Live Sprint"
              />
            </div>
            <div>
              <Label htmlFor="exam-subject">Subject / cohort</Label>
              <Input
                id="exam-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Physics · Semester 5"
              />
            </div>
          </div>

          <div>
            <GroupLabel id="exam-question-picker" hint={`${picked.length} of ${orderedQuestions.length} selected`}>
              Select questions (in delivery order)
            </GroupLabel>
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <Input
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Filter by prompt or topic…"
                  aria-label="Filter questions"
                  className="py-2 pl-9 sm:py-2"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setPicked((prev) => [...prev, ...pickerRows.map((q) => q.id).filter((id) => !prev.includes(id))])
                }
                disabled={pickerRows.length === 0}
              >
                Add all {pickerRows.length}
              </Button>
              {picked.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
                  Clear
                </Button>
              )}
            </div>
            <div
              role="group"
              aria-labelledby="exam-question-picker"
              className="max-h-[320px] space-y-2 overflow-y-auto pr-1"
            >
              {pickerRows.length === 0 && (
                <p className="py-6 text-center text-[13px] text-white/50">No questions match that filter.</p>
              )}
              {pickerRows.map((q, idx) => {
                const selected = picked.includes(q.id);
                const order = picked.indexOf(q.id) + 1;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => toggle(q.id)}
                    className={cx(
                      'flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition',
                      selected
                        ? 'border-royal-400/50 bg-royal-500/[0.09]'
                        : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20'
                    )}
                  >
                    <span
                      className={cx(
                        'num mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] font-semibold',
                        selected ? 'border-transparent bg-royal-500 text-white' : 'border-white/15 text-white/45'
                      )}
                    >
                      {selected ? order : idx + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13.5px] leading-relaxed text-white/80">{q.prompt}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <TypePill type={q.type} />
                        <Badge tone="neutral">{q.topic}</Badge>
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-white/45">
                          <Timer className="h-3 w-3" /> {q.timerSeconds}s · {q.points} pts
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-3 py-2 text-[13px] text-ember-400">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </AdminShell>
  );
}
