'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  FileUp,
  Filter,
  Pencil,
  Plus,
  Search,
  Send,
  Timer,
  Trash2,
  X
} from 'lucide-react';
import { PushDialog } from '@/components/PushDialog';
import { AdminShell } from '@/components/AdminShell';
import { Badge, EmptyState, Panel, SectionHead } from '@/components/ui/Panel';
import { Button, IconButton, LinkButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { GroupLabel, Input, Label, Select, TextArea } from '@/components/ui/Field';
import { Loading, TypePill, typeLabel } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, cx } from '@/lib/api';
import type { Difficulty, Question, QuestionInput, QuestionType } from '@shared/types';

const TYPES: QuestionType[] = ['mcq', 'truefalse', 'fill', 'short', 'long'];

const blank: QuestionInput = {
  type: 'mcq',
  prompt: '',
  topic: '',
  difficulty: 'medium',
  options: ['', '', '', ''],
  correctOptionIndex: 0,
  acceptedAnswers: [],
  points: 10,
  timerSeconds: 45,
  explanation: ''
};

export default function QuestionBankPage() {
  const { push } = useToast();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all');
  const [editing, setEditing] = useState<Question | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<QuestionInput>(blank);
  const [answersText, setAnswersText] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pushTarget, setPushTarget] = useState<Question | null>(null);
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [paperFilter, setPaperFilter] = useState<'all' | 'manual' | string>('all');
  const [papers, setPapers] = useState<{ id: string; name: string; questionCount: number }[]>([]);

  const load = () =>
    api<{ questions: Question[] }>('/questions')
      .then((res) => {
        setQuestions(res.questions);
        setTimers((prev) => {
          const next = { ...prev };
          res.questions.forEach((q) => {
            if (next[q.id] === undefined) next[q.id] = q.timerSeconds;
          });
          return next;
        });
      })
      .catch((err: Error) => push({ kind: 'error', title: 'Could not load question bank', body: err.message }));

  useEffect(() => {
    void load();
    api<{ papers: { id: string; name: string; questionCount: number }[] }>('/papers')
      .then((res) => setPapers(res.papers))
      .catch(() => setPapers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const rows = questions ?? [];
    return rows.filter((q) => {
      const matchesType = typeFilter === 'all' || q.type === typeFilter;
      const s = search.trim().toLowerCase();
      const matchesSearch =
        !s || q.prompt.toLowerCase().includes(s) || q.topic.toLowerCase().includes(s);
      const matchesPaper =
        paperFilter === 'all'
          ? true
          : paperFilter === 'manual'
            ? !q.sourcePaperId
            : q.sourcePaperId === paperFilter;
      return matchesType && matchesSearch && matchesPaper;
    });
  }, [questions, typeFilter, search, paperFilter]);

  function openNew() {
    setEditing(null);
    setForm(blank);
    setAnswersText('');
    setFormError(null);
    setOpen(true);
  }

  function openEdit(q: Question) {
    setEditing(q);
    setForm({
      type: q.type,
      prompt: q.prompt,
      topic: q.topic,
      difficulty: q.difficulty,
      options: q.type === 'mcq' ? [...q.options] : ['', '', '', ''],
      correctOptionIndex: q.correctOptionIndex ?? 0,
      acceptedAnswers: q.acceptedAnswers,
      points: q.points,
      timerSeconds: q.timerSeconds,
      explanation: q.explanation
    });
    setAnswersText(q.acceptedAnswers.join('\n'));
    setFormError(null);
    setOpen(true);
  }

  function setType(type: QuestionType) {
    setForm((f) => ({
      ...f,
      type,
      options:
        type === 'truefalse' ? ['True', 'False'] : type === 'mcq' ? (f.options.length >= 2 ? f.options : ['', '', '', '']) : [],
      correctOptionIndex: type === 'truefalse' ? 0 : type === 'mcq' ? f.correctOptionIndex ?? 0 : null,
      points: type === 'long' ? Math.max(f.points, 20) : f.points,
      timerSeconds: type === 'long' ? Math.max(f.timerSeconds, 180) : f.timerSeconds
    }));
  }

  async function save() {
    setBusy(true);
    setFormError(null);
    const payload: QuestionInput = {
      ...form,
      topic: form.topic.trim() || 'General',
      acceptedAnswers:
        form.type === 'mcq' || form.type === 'truefalse'
          ? []
          : answersText
              .split('\n')
              .map((a) => a.trim())
              .filter(Boolean)
    };
    try {
      if (editing) {
        await api(`/questions/${editing.id}`, { method: 'PATCH', body: payload });
        push({ kind: 'success', title: 'Question updated' });
      } else {
        await api('/questions', { method: 'POST', body: payload });
        push({ kind: 'success', title: 'Question added to the bank', body: 'It is ready to push in any session.' });
      }
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the question');
    } finally {
      setBusy(false);
    }
  }

  async function remove(q: Question) {
    try {
      await api(`/questions/${q.id}`, { method: 'DELETE' });
      push({ kind: 'success', title: 'Question removed' });
      await load();
    } catch (err) {
      push({ kind: 'error', title: 'Cannot delete', body: err instanceof ApiError ? err.message : 'Try again' });
    }
  }

  const needsOptions = form.type === 'mcq';
  const needsAnswers = form.type === 'fill' || form.type === 'short' || form.type === 'long';

  return (
    <AdminShell
      title="Question bank"
      subtitle="Author any format · every question carries its own timer and answer key"
      action={
        <div className="flex gap-2">
          <LinkButton href="/admin/papers" variant="secondary" size="sm">
            <FileUp className="h-3.5 w-3.5" /> Upload paper
          </LinkButton>
          <Button size="sm" variant="lime" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> New question
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* toolbar */}
        <Panel className="flex flex-wrap items-center gap-2.5 p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompt or topic…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 hidden items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-white/25 sm:flex">
              <Filter className="h-3 w-3" /> type
            </span>
            {(['all', ...TYPES] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t as 'all' | QuestionType)}
                className={cx(
                  'rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition',
                  typeFilter === t
                    ? 'bg-white/[0.09] text-white ring-1 ring-inset ring-white/15'
                    : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
                )}
              >
                {t === 'all' ? 'All' : t === 'truefalse' ? 'T/F' : t.toUpperCase()}
              </button>
            ))}
          </div>
        </Panel>

        {papers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] uppercase tracking-[0.12em] text-white/25">source</span>
            {[
              { id: 'all' as const, label: `All (${questions?.length ?? 0})` },
              { id: 'manual' as const, label: 'Manual' },
              ...papers.map((p) => ({ id: p.id, label: `${p.name.length > 28 ? `${p.name.slice(0, 28)}…` : p.name} (${p.questionCount})` }))
            ].map((chip) => (
              <button
                key={chip.id}
                onClick={() => setPaperFilter(chip.id)}
                className={cx(
                  'max-w-[240px] truncate rounded-lg border px-2.5 py-1.5 text-[11.5px] transition',
                  paperFilter === chip.id
                    ? 'border-aurora-400/40 bg-aurora-500/[0.12] text-white'
                    : 'border-white/[0.08] bg-white/[0.02] text-white/45 hover:border-white/25 hover:text-white/80'
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {!questions ? (
          <Panel className="p-6">
            <Loading label="Loading question bank" />
          </Panel>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title="No questions match this filter"
            body="Try a different format or clear the search to see the whole bank."
            action={
              <Button variant="secondary" size="sm" onClick={() => { setSearch(''); setTypeFilter('all'); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.map((q) => (
              <Panel key={q.id} hover className="group p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <TypePill type={q.type} />
                      <Badge tone="neutral">{q.topic}</Badge>
                      <Badge tone={q.difficulty === 'hard' ? 'ember' : q.difficulty === 'easy' ? 'mint' : 'violet'}>
                        {q.difficulty}
                      </Badge>
                      <span className="num inline-flex items-center gap-1 text-[11px] text-white/35">
                        <Timer className="h-3 w-3" /> {q.timerSeconds}s
                      </span>
                      <span className="num text-[11px] text-white/35">{q.points} pts</span>
                      {q.sourcePaperId && (
                        <Link href={`/admin/papers/${q.sourcePaperId}`}>
                          <Badge tone="sky">from paper</Badge>
                        </Link>
                      )}
                    </div>
                    <p className="text-[13.5px] leading-relaxed text-white/85">{q.prompt}</p>

                    {(q.type === 'mcq' || q.type === 'truefalse') && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {q.options.map((opt, i) => (
                          <span
                            key={`${q.id}-opt-${i}`}
                            className={cx(
                              'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px]',
                              i === q.correctOptionIndex
                                ? 'border-mint-400/40 bg-mint-500/10 text-mint-200'
                                : 'border-white/[0.08] bg-white/[0.02] text-white/45'
                            )}
                          >
                            {i === q.correctOptionIndex && <Check className="h-3 w-3" />}
                            <span className="font-mono">{String.fromCharCode(65 + i)}</span>
                            <span className="max-w-[220px] truncate">{opt}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {needsAnswersForDisplay(q) && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10.5px] uppercase tracking-[0.12em] text-white/25">accepted</span>
                        {q.acceptedAnswers.length === 0 ? (
                          <span className="text-[11.5px] text-amber-300/80">manual review</span>
                        ) : (
                          q.acceptedAnswers.map((a) => (
                            <span
                              key={`${q.id}-ans-${a}`}
                              className="rounded-md border border-mint-400/25 bg-mint-500/10 px-1.5 py-0.5 text-[11px] text-mint-200"
                            >
                              {a}
                            </span>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-ink-900/70 px-2 py-1">
                      <Timer className="h-3.5 w-3.5 text-white/30" />
                      <input
                        type="number"
                        min={5}
                        max={3600}
                        value={timers[q.id] ?? q.timerSeconds}
                        onChange={(e) => setTimers((prev) => ({ ...prev, [q.id]: Number(e.target.value) }))}
                        onBlur={async (e) => {
                          const seconds = Math.max(5, Math.min(3600, Number(e.target.value)));
                          setTimers((prev) => ({ ...prev, [q.id]: seconds }));
                          if (seconds === q.timerSeconds) return;
                          try {
                            const res = await api<{ question: Question }>(`/questions/${q.id}`, {
                              method: 'PATCH',
                              body: { ...q, timerSeconds: seconds }
                            });
                            setQuestions((prev) =>
                              prev ? prev.map((row) => (row.id === q.id ? res.question : row)) : prev
                            );
                            push({ kind: 'success', title: 'Timer updated', body: `${seconds}s saved.` });
                          } catch (err) {
                            push({ kind: 'error', title: 'Timer not saved', body: (err as Error).message });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        className="num w-12 bg-transparent text-[12.5px] text-white/85 outline-none"
                        aria-label="Timer seconds"
                      />
                      <span className="text-[10.5px] text-white/30">s</span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setPushTarget(q)}>
                      <Send className="h-3.5 w-3.5" /> Push
                    </Button>
                    <IconButton onClick={() => openEdit(q)} aria-label="Edit question">
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      onClick={() => remove(q)}
                      aria-label="Delete question"
                      className="hover:border-ember-500/40 hover:text-ember-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}

        <p className="text-center text-[11px] text-white/20">
          Showing {filtered.length} of {questions?.length ?? 0} questions · answer keys are never sent to student devices
        </p>
      </div>

      <PushDialog
        open={!!pushTarget}
        question={pushTarget}
        onClose={() => setPushTarget(null)}
        onPushed={() => void load()}
      />

      {/* composer */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit question' : 'Compose a question'}
        description="Every question stores its own answer key, points and timer — that is what makes live pushing instant."
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="lime" size="sm" loading={busy} onClick={save}>
              {editing ? 'Save changes' : 'Add to bank'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <GroupLabel id="qf-format">Question format</GroupLabel>
            <div role="group" aria-labelledby="qf-format" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cx(
                    'rounded-xl border px-2 py-2.5 text-left transition',
                    form.type === t
                      ? 'border-aurora-400/50 bg-aurora-500/[0.12]'
                      : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                  )}
                >
                  <p className="text-[11.5px] font-semibold text-white/85">
                    {t === 'truefalse' ? 'True/False' : t === 'mcq' ? 'MCQ' : t === 'fill' ? 'Fill blank' : t === 'short' ? 'Short' : 'Long'}
                  </p>
                  <p className="mt-0.5 text-[9.5px] uppercase tracking-[0.08em] text-white/30">
                    {t === 'long' ? 'manual' : 'auto'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="qf-prompt" hint={`${form.prompt.length}/600`}>Prompt</Label>
            <TextArea id="qf-prompt"
              rows={3}
              maxLength={600}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder="Type the question exactly as students should read it…"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="qf-topic">Topic</Label>
              <Input id="qf-topic"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="Quantum Mechanics"
              />
            </div>
            <div>
              <Label htmlFor="qf-difficulty">Difficulty</Label>
              <Select id="qf-difficulty"
                value={form.difficulty}
                onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="qf-timer" hint="seconds">Timer</Label>
              <Input id="qf-timer"
                type="number"
                min={5}
                max={3600}
                value={form.timerSeconds}
                onChange={(e) => setForm({ ...form, timerSeconds: Number(e.target.value) })}
              />
            </div>
          </div>

          {needsOptions && (
            <div>
              <GroupLabel id="qf-options" hint="click the circle to mark the correct option">Options</GroupLabel>
              <div role="group" aria-labelledby="qf-options" className="space-y-2">
                {form.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, correctOptionIndex: i })}
                      className={cx(
                        'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition',
                        form.correctOptionIndex === i
                          ? 'border-transparent bg-mint-500 text-ink-950'
                          : 'border-white/15 text-white/40 hover:border-white/35'
                      )}
                      aria-label={`Mark option ${i + 1} correct`}
                    >
                      {form.correctOptionIndex === i ? <Check className="h-3.5 w-3.5" /> : String.fromCharCode(65 + i)}
                    </button>
                    <Input
                      value={opt}
                      onChange={(e) => {
                        const next = [...form.options];
                        next[i] = e.target.value;
                        setForm({ ...form, options: next });
                      }}
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    />
                    {form.options.length > 2 && (
                      <IconButton
                        onClick={() =>
                          setForm({
                            ...form,
                            options: form.options.filter((_, idx) => idx !== i),
                            correctOptionIndex:
                              form.correctOptionIndex === i ? 0 : form.correctOptionIndex
                          })
                        }
                        aria-label="Remove option"
                      >
                        <X className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
                  </div>
                ))}
                {form.options.length < 6 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm({ ...form, options: [...form.options, ''] })}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add option
                  </Button>
                )}
              </div>
            </div>
          )}

          {form.type === 'truefalse' && (
            <div>
              <GroupLabel id="qf-correct">Correct answer</GroupLabel>
              <div role="group" aria-labelledby="qf-correct" className="flex gap-2">
                {['True', 'False'].map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setForm({ ...form, correctOptionIndex: i })}
                    className={cx(
                      'flex-1 rounded-xl border px-3 py-2.5 text-[12.5px] transition',
                      form.correctOptionIndex === i
                        ? 'border-mint-400/50 bg-mint-500/10 text-mint-200'
                        : 'border-white/[0.08] bg-white/[0.02] text-white/50 hover:border-white/20'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsAnswers && (
            <div>
              <Label htmlFor="qf-accepted" hint="one per line · matching is case & typo tolerant">Accepted answers</Label>
              <TextArea id="qf-accepted"
                rows={form.type === 'long' ? 2 : 3}
                value={answersText}
                onChange={(e) => setAnswersText(e.target.value)}
                placeholder={form.type === 'long' ? 'Leave empty to send every response for manual review' : 'azimuthal\nangular momentum'}
              />
              {form.type === 'long' && !answersText.trim() && (
                <p className="mt-1.5 text-[11px] text-amber-300/80">
                  Long answers without keys are queued for manual scoring — that is the expected behaviour.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
            <div>
              <Label htmlFor="qf-points">Points</Label>
              <Input id="qf-points"
                type="number"
                min={1}
                max={100}
                value={form.points}
                onChange={(e) => setForm({ ...form, points: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="qf-explanation" hint="optional">Explanation shown after locking</Label>
              <Input id="qf-explanation"
                value={form.explanation}
                onChange={(e) => setForm({ ...form, explanation: e.target.value })}
                placeholder="Why this is the answer…"
              />
            </div>
          </div>

          {formError && (
            <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-3 py-2 text-[12px] text-ember-400">
              {formError}
            </p>
          )}
        </div>
      </Modal>
    </AdminShell>
  );
}

function needsAnswersForDisplay(q: Question) {
  return q.type === 'fill' || q.type === 'short' || q.type === 'long';
}
