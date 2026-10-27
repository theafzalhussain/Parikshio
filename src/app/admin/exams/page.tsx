'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, BarChart3, Copy, Plus, Radio, Timer, Users } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { Badge, EmptyState, Panel, SectionHead } from '@/components/ui/Panel';
import { Button, LinkButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { GroupLabel, Input, Label } from '@/components/ui/Field';
import { Loading, StatusPill, TypePill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, cx } from '@/lib/api';
import type { AdminExamRow, Question } from '@shared/types';

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

  const load = async () => {
    try {
      const [examRes, qRes] = await Promise.all([
        api<{ exams: AdminExamRow[] }>('/exams'),
        api<{ questions: Question[] }>('/questions')
      ]);
      setExams(examRes.exams);
      setQuestions(qRes.questions);
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

  return (
    <AdminShell
      title="Live sessions"
      subtitle="Create a session, then push questions into it with their own timers"
      action={
        <Button size="sm" variant="lime" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New session
        </Button>
      }
    >
      <div className="space-y-4">
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
              <Button size="sm" variant="lime" onClick={() => setOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Create session
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {exams.map((exam) => {
              const progress = exam.questionIds.length
                ? Math.round((exam.pushedCount / exam.questionIds.length) * 100)
                : 0;
              return (
                <Panel key={exam.id} hover className="overflow-hidden p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={exam.status} />
                        <span className="rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[10.5px] tracking-[0.1em] text-white/50">
                          {exam.code}
                        </span>
                      </div>
                      <h3 className="mt-2 truncate text-[15px] font-semibold text-white">{exam.title}</h3>
                      <p className="mt-0.5 truncate text-[11.5px] text-white/35">
                        {exam.subject} · {exam.adminName}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(exam.code);
                        push({ kind: 'info', title: 'Join code copied', body: exam.code });
                      }}
                      className="rounded-lg border border-white/10 p-1.5 text-white/35 transition hover:text-white"
                      aria-label="Copy join code"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      { icon: Radio, label: 'questions', value: exam.questionIds.length },
                      { icon: Users, label: 'students', value: exam.participation },
                      { icon: BarChart3, label: 'avg pts', value: exam.avgScore }
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
                        <s.icon className="h-3.5 w-3.5 text-white/25" />
                        <p className="num mt-1.5 text-[14px] font-semibold text-white">{s.value}</p>
                        <p className="text-[9.5px] uppercase tracking-[0.12em] text-white/30">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-[10.5px] text-white/30">
                      <span>delivery progress</span>
                      <span className="num">{progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-aurora-400 to-lime-400 transition-all duration-700"
                        style={{ width: `${Math.max(progress, 2)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <LinkButton href={`/admin/exams/${exam.id}`} size="sm" variant={exam.status === 'live' ? 'lime' : 'secondary'} className="flex-1">
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
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a live session"
        description="Give it a title, then pick the questions you want queued. You can push them one at a time from the control room."
        width="max-w-3xl"
        footer={
          <>
            <span className="mr-auto text-[11.5px] text-white/35">{picked.length} selected</span>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="lime" size="sm" loading={busy} onClick={create} disabled={!title.trim() || picked.length === 0}>
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
            <GroupLabel id="exam-question-picker" hint={`${orderedQuestions.length} in bank`}>
              Select questions (in delivery order)
            </GroupLabel>
            <div
              role="group"
              aria-labelledby="exam-question-picker"
              className="max-h-[320px] space-y-2 overflow-y-auto pr-1"
            >
              {orderedQuestions.map((q, idx) => {
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
                        ? 'border-aurora-400/50 bg-aurora-500/[0.09]'
                        : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20'
                    )}
                  >
                    <span
                      className={cx(
                        'num mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] font-semibold',
                        selected ? 'border-transparent bg-aurora-500 text-white' : 'border-white/15 text-white/30'
                      )}
                    >
                      {selected ? order : idx + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[12.5px] leading-relaxed text-white/80">{q.prompt}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <TypePill type={q.type} />
                        <Badge tone="neutral">{q.topic}</Badge>
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-white/30">
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
            <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-3 py-2 text-[12px] text-ember-400">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </AdminShell>
  );
}
