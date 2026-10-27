'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  FileText,
  Pencil,
  Radio,
  Rocket,
  Search,
  Send,
  Timer,
  Trash2
} from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { Badge, Divider, EmptyState, Panel, SectionHead } from '@/components/ui/Panel';
import { Button, IconButton, LinkButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Loading, StatusPill, TypePill, typeLabel } from '@/components/ui/Pills';
import { QuestionEditModal } from '@/components/QuestionEditModal';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, cx, fmtRelative } from '@/lib/api';
import type { Exam, Paper, Question } from '@shared/types';

interface Detail {
  paper: Paper & { questionCount: number };
  questions: Question[];
  exam: Exam | null;
}

export default function PaperWorkbenchPage() {
  const params = useParams<{ id: string }>();
  const paperId = params?.id ?? '';
  const router = useRouter();
  const { push } = useToast();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [edited, setEdited] = useState<Question | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [search, setSearch] = useState('');
  const [bulkTimer, setBulkTimer] = useState(45);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<Detail>(`/papers/${paperId}`);
      setDetail(res);
      setTimers((prev) => {
        const next = { ...prev };
        res.questions.forEach((q) => {
          if (next[q.id] === undefined) next[q.id] = q.timerSeconds;
        });
        return next;
      });
    } catch (err) {
      push({ kind: 'error', title: 'Could not open paper', body: (err as Error).message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  useEffect(() => {
    void load();
  }, [load]);

  const questions = detail?.questions ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s
      ? questions.filter((q) => q.prompt.toLowerCase().includes(s) || q.topic.toLowerCase().includes(s))
      : questions;
  }, [questions, search]);

  /** Save a single question's timer (used on blur / preset click). */
  async function saveTimer(question: Question, seconds: number) {
    const clamped = Math.max(5, Math.min(3600, Math.round(seconds)));
    setTimers((prev) => ({ ...prev, [question.id]: clamped }));
    if (clamped === question.timerSeconds) return;
    try {
      const res = await api<{ question: Question }>(`/questions/${question.id}`, {
        method: 'PATCH',
        body: {
          type: question.type,
          prompt: question.prompt,
          topic: question.topic,
          difficulty: question.difficulty,
          options: question.options,
          correctOptionIndex: question.correctOptionIndex,
          acceptedAnswers: question.acceptedAnswers,
          points: question.points,
          timerSeconds: clamped,
          explanation: question.explanation
        }
      });
      setDetail((prev) =>
        prev ? { ...prev, questions: prev.questions.map((q) => (q.id === question.id ? res.question : q)) } : prev
      );
    } catch (err) {
      push({ kind: 'error', title: 'Timer not saved', body: (err as Error).message });
    }
  }

  async function applyTimerToAll() {
    setApplying(true);
    try {
      await Promise.all(questions.map((q) => saveTimer(q, bulkTimer)));
      setTimers(Object.fromEntries(questions.map((q) => [q.id, bulkTimer])));
      push({ kind: 'success', title: `All timers set to ${bulkTimer}s`, body: `${questions.length} questions updated.` });
    } finally {
      setApplying(false);
    }
  }

  async function publish(): Promise<Exam | null> {
    if (!detail) return null;
    setPublishing(true);
    try {
      const res = await api<{ exam: Exam; created: boolean }>(`/papers/${paperId}/exam`, { method: 'POST', body: {} });
      setDetail({ ...detail, exam: res.exam });
      push({
        kind: 'success',
        title: res.created ? 'Session created from paper' : 'Session ready',
        body: `Join code ${res.exam.code} — push any question to go live.`
      });
      return res.exam;
    } catch (err) {
      push({ kind: 'error', title: 'Could not create session', body: err instanceof ApiError ? err.message : 'Try again' });
      return null;
    } finally {
      setPublishing(false);
    }
  }

  async function pushQuestion(question: Question) {
    setBusyId(question.id);
    try {
      const exam = detail?.exam ?? (await publish());
      if (!exam) return;
      await api(`/exams/${exam.id}/questions`, { method: 'POST', body: { questionId: question.id } });
      await api(`/exams/${exam.id}/push`, {
        method: 'POST',
        body: { questionId: question.id, timerSeconds: timers[question.id] ?? question.timerSeconds }
      });
      push({
        kind: 'success',
        title: 'Pushed live',
        body: `Q${question.sourceIndex ?? ''} is on every student screen for ${timers[question.id] ?? question.timerSeconds}s.`
      });
      await load();
    } catch (err) {
      push({ kind: 'error', title: 'Push failed', body: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  async function removeQuestion(question: Question) {
    try {
      await api(`/questions/${question.id}`, { method: 'DELETE' });
      setDetail((prev) =>
        prev
          ? { ...prev, questions: prev.questions.filter((q) => q.id !== question.id), paper: { ...prev.paper, questionCount: prev.paper.questionCount - 1 } }
          : prev
      );
      push({ kind: 'success', title: 'Question deleted' });
    } catch (err) {
      push({ kind: 'error', title: 'Cannot delete', body: err instanceof ApiError ? err.message : 'Try again' });
    }
  }

  const paper = detail?.paper;
  const missingKeys = questions.filter(
    (q) => (q.type === 'mcq' || q.type === 'truefalse') && q.correctOptionIndex === null
  ).length;

  return (
    <AdminShell
      title={paper?.name ?? 'Paper workbench'}
      subtitle={
        paper
          ? `${paper.fileName} · ${paper.questionCount} questions · imported ${fmtRelative(paper.uploadedAt)}`
          : undefined
      }
      action={
        detail?.exam ? (
          <LinkButton href={`/admin/exams/${detail.exam.id}`} variant="lime" size="sm">
            <Radio className="h-3.5 w-3.5" /> Control room
          </LinkButton>
        ) : (
          <Button variant="lime" size="sm" loading={publishing} onClick={() => publish()}>
            <Rocket className="h-3.5 w-3.5" /> Publish session
          </Button>
        )
      }
    >
      {!detail || !paper ? (
        <Panel className="p-6">
          <Loading label="Opening paper workbench" />
        </Panel>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/admin/papers" className="inline-flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> All papers
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              {detail.exam && (
                <>
                  <StatusPill status={detail.exam.status} />
                  <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[11px] tracking-[0.14em] text-white/55">
                    {detail.exam.code}
                  </span>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={() => router.push('/admin/questions')}>
                <FileText className="h-3.5 w-3.5" /> Question bank
              </Button>
            </div>
          </div>

          {/* summary */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { k: 'Questions extracted', v: paper.questionCount, hint: `${paper.stats.withOptions} with options` },
              {
                k: 'Answer keys found',
                v: `${paper.stats.withAnswers}/${paper.questionCount}`,
                hint: missingKeys ? `${missingKeys} to review` : 'all matched'
              },
              {
                k: 'Parse confidence',
                v: `${Math.round(paper.stats.averageConfidence * 100)}%`,
                hint: paper.ocrUsed ? 'OCR text' : 'text layer'
              },
              {
                k: 'Session',
                v: detail.exam ? detail.exam.code : 'not created',
                hint: detail.exam ? `${detail.exam.status}` : 'publish to start pushing'
              }
            ].map((s) => (
              <div key={s.k} className="rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.045] to-white/[0.015] p-4">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/40">{s.k}</p>
                <p className="num mt-1.5 text-[19px] font-semibold text-white">{s.v}</p>
                <p className="mt-0.5 text-[11px] text-white/30">{s.hint}</p>
              </div>
            ))}
          </div>

          {paper.warnings.length > 0 && (
            <Panel className="border-amber-400/20 bg-amber-400/[0.04] p-4">
              <p className="flex items-center gap-2 text-[12px] font-medium text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" /> Parser notes for this file
              </p>
              <ul className="mt-2 space-y-1">
                {paper.warnings.map((w) => (
                  <li key={w} className="text-[11.5px] leading-relaxed text-white/45">
                    • {w}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* toolbar */}
          <Panel className="flex flex-wrap items-center gap-2.5 p-3">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search this paper…"
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-ink-900/60 p-1">
              <Timer className="ml-1.5 h-3.5 w-3.5 text-white/30" />
              <input
                type="number"
                min={5}
                max={3600}
                value={bulkTimer}
                onChange={(e) => setBulkTimer(Number(e.target.value))}
                className="num w-14 bg-transparent text-[12.5px] text-white/80 outline-none"
                aria-label="Bulk timer seconds"
              />
              <span className="text-[11px] text-white/30">s for all</span>
              <Button variant="secondary" size="sm" loading={applying} onClick={applyTimerToAll}>
                Apply
              </Button>
            </div>
            {!detail.exam && (
              <Button variant="outline" size="sm" loading={publishing} onClick={() => publish()}>
                <Rocket className="h-3.5 w-3.5" /> Publish session
              </Button>
            )}
          </Panel>

          {/* questions */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title="No questions match"
              body="Clear the search to see every extracted question."
            />
          ) : (
            <div className="space-y-2.5">
              {filtered.map((q, index) => {
                const needsReview = (q.type === 'mcq' || q.type === 'truefalse') && q.correctOptionIndex === null;
                return (
                  <Panel key={q.id} hover className="p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="num mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-[11.5px] font-semibold text-white/45 ring-1 ring-inset ring-white/10">
                        {q.sourceIndex ?? index + 1}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <TypePill type={q.type} />
                          <Badge tone="neutral">{typeLabel(q.type)}</Badge>
                          <span className="num text-[11px] text-white/35">{q.points} pts</span>
                          {needsReview ? (
                            <Badge tone="amber">
                              <AlertTriangle className="h-3 w-3" /> key missing
                            </Badge>
                          ) : (
                            <Badge tone="mint">
                              <Check className="h-3 w-3" /> ready
                            </Badge>
                          )}
                        </div>

                        <p className="text-[13.5px] leading-relaxed text-white/85">{q.prompt}</p>

                        {(q.type === 'mcq' || q.type === 'truefalse') && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {q.options.map((opt, i) => (
                              <span
                                key={i}
                                className={cx(
                                  'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px]',
                                  i === q.correctOptionIndex
                                    ? 'border-mint-400/40 bg-mint-500/10 text-mint-200'
                                    : 'border-white/[0.08] bg-white/[0.02] text-white/45'
                                )}
                              >
                                {i === q.correctOptionIndex && <Check className="h-3 w-3" />}
                                <span className="font-mono">{String.fromCharCode(65 + i)}</span>
                                <span className="max-w-[240px] truncate">{opt}</span>
                              </span>
                            ))}
                          </div>
                        )}

                        {q.type !== 'mcq' && q.type !== 'truefalse' && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-[0.12em] text-white/25">accepted</span>
                            {q.acceptedAnswers.length === 0 ? (
                              <span className="text-[11.5px] text-amber-300/80">
                                {q.type === 'long' ? 'manual review' : 'no key — add one to auto-grade'}
                              </span>
                            ) : (
                              q.acceptedAnswers.map((a) => (
                                <span
                                  key={a}
                                  className="rounded-md border border-mint-400/25 bg-mint-500/10 px-1.5 py-0.5 text-[11px] text-mint-200"
                                >
                                  {a}
                                </span>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      {/* per-question controls */}
                      <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                        <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-ink-900/70 px-2 py-1">
                          <Timer className="h-3.5 w-3.5 text-white/30" />
                          <input
                            type="number"
                            min={5}
                            max={3600}
                            value={timers[q.id] ?? q.timerSeconds}
                            onChange={(e) => setTimers((prev) => ({ ...prev, [q.id]: Number(e.target.value) }))}
                            onBlur={(e) => saveTimer(q, Number(e.target.value))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                            className="num w-12 bg-transparent text-[12.5px] text-white/85 outline-none"
                            aria-label={`Timer seconds for question ${q.sourceIndex ?? index + 1}`}
                          />
                          <span className="text-[10.5px] text-white/30">s</span>
                        </div>
                        <Button
                          size="sm"
                          variant="lime"
                          loading={busyId === q.id}
                          onClick={() => pushQuestion(q)}
                          className="shrink-0"
                        >
                          <Send className="h-3.5 w-3.5" /> Push
                        </Button>
                        <IconButton onClick={() => setEdited(q)} aria-label="Edit question">
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          onClick={() => removeQuestion(q)}
                          aria-label="Delete question"
                          className="hover:border-ember-500/40 hover:text-ember-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}

          <Panel className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12.5px] font-medium text-white/80">Ready to run this paper?</p>
                <p className="mt-0.5 text-[11.5px] text-white/40">
                  {detail.exam
                    ? `Session ${detail.exam.code} holds all ${paper.questionCount} questions in paper order — push them one by one from the control room.`
                    : 'Publishing creates one session with every question in paper order.'}
                </p>
              </div>
              <div className="flex gap-2">
                {detail.exam ? (
                  <LinkButton href={`/admin/exams/${detail.exam.id}`} variant="lime" size="sm">
                    <Radio className="h-3.5 w-3.5" /> Open control room <ArrowUpRight className="h-3.5 w-3.5" />
                  </LinkButton>
                ) : (
                  <Button variant="lime" size="sm" loading={publishing} onClick={() => publish()}>
                    <Rocket className="h-3.5 w-3.5" /> Publish session
                  </Button>
                )}
                <LinkButton href={`/admin/analytics${detail.exam ? `/${detail.exam.id}` : ''}`} variant="secondary" size="sm">
                  Analytics
                </LinkButton>
              </div>
            </div>
          </Panel>
        </div>
      )}

      <QuestionEditModal
        open={!!edited}
        question={edited}
        onClose={() => setEdited(null)}
        onSaved={(updated) => {
          setDetail((prev) =>
            prev ? { ...prev, questions: prev.questions.map((q) => (q.id === updated.id ? updated : q)) } : prev
          );
          setTimers((prev) => ({ ...prev, [updated.id]: updated.timerSeconds }));
        }}
      />
    </AdminShell>
  );
}
