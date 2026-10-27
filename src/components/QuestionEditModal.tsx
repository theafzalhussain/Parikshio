'use client';

import { useEffect, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { Difficulty, Question, QuestionType } from '@shared/types';
import { api, ApiError, cx } from '@/lib/api';
import { Button, IconButton } from './ui/Button';
import { GroupLabel, Input, Label, Select, TextArea } from './ui/Field';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toast';

const TYPES: QuestionType[] = ['mcq', 'truefalse', 'fill', 'short', 'long'];
const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'MCQ',
  truefalse: 'True/False',
  fill: 'Fill blank',
  short: 'Short',
  long: 'Long'
};

interface FormState {
  type: QuestionType;
  prompt: string;
  topic: string;
  difficulty: Difficulty;
  options: string[];
  correctOptionIndex: number;
  points: number;
  timerSeconds: number;
  explanation: string;
}

const empty: FormState = {
  type: 'mcq',
  prompt: '',
  topic: 'General',
  difficulty: 'medium',
  options: ['', '', '', ''],
  correctOptionIndex: 0,
  points: 5,
  timerSeconds: 45,
  explanation: ''
};

export function QuestionEditModal({
  open,
  onClose,
  question,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  question: Question | null;
  onSaved?: (q: Question) => void;
}) {
  const { push } = useToast();
  const [form, setForm] = useState<FormState>(empty);
  const [answers, setAnswers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !question) return;
    setError(null);
    setForm({
      type: question.type,
      prompt: question.prompt,
      topic: question.topic,
      difficulty: question.difficulty,
      options: question.type === 'mcq' && question.options.length ? [...question.options] : ['', '', '', ''],
      correctOptionIndex: question.correctOptionIndex ?? 0,
      points: question.points,
      timerSeconds: question.timerSeconds,
      explanation: question.explanation ?? ''
    });
    setAnswers(question.acceptedAnswers.join('\n'));
  }, [open, question]);

  function setType(type: QuestionType) {
    setForm((f) => ({
      ...f,
      type,
      options: type === 'truefalse' ? ['True', 'False'] : type === 'mcq' ? (f.options.length >= 2 ? f.options : ['', '', '', '']) : [],
      correctOptionIndex: type === 'truefalse' ? 0 : f.correctOptionIndex
    }));
  }

  async function save() {
    if (!question) return;
    setBusy(true);
    setError(null);
    const payload = {
      type: form.type,
      prompt: form.prompt,
      topic: form.topic || 'General',
      difficulty: form.difficulty,
      options: form.type === 'mcq' ? form.options.map((o) => o.trim()).filter(Boolean) : form.type === 'truefalse' ? ['True', 'False'] : [],
      correctOptionIndex: form.type === 'mcq' || form.type === 'truefalse' ? form.correctOptionIndex : null,
      acceptedAnswers:
        form.type === 'mcq' || form.type === 'truefalse'
          ? []
          : answers.split('\n').map((a) => a.trim()).filter(Boolean),
      points: form.points,
      timerSeconds: form.timerSeconds,
      explanation: form.explanation
    };
    try {
      const res = await api<{ question: Question }>(`/questions/${question.id}`, { method: 'PATCH', body: payload });
      push({ kind: 'success', title: 'Question updated', body: 'Timer and answer key saved.' });
      onSaved?.(res.question);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes');
    } finally {
      setBusy(false);
    }
  }

  const needsOptions = form.type === 'mcq';
  const needsAnswers = form.type === 'fill' || form.type === 'short' || form.type === 'long';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit question"
      description={question?.sourcePaperName ? `Imported from ${question.sourcePaperName}` : undefined}
      width="max-w-3xl"
      footer={
        <>
          <span className="mr-auto text-[11px] text-white/30">
            {question?.sourcePaperName ? `Source · ${question.sourcePaperName}` : 'Manual entry'}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="lime" size="sm" loading={busy} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <GroupLabel id="qe-format">Question format</GroupLabel>
          <div role="group" aria-labelledby="qe-format" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cx(
                  'rounded-xl border px-2 py-2 text-[11.5px] font-medium transition',
                  form.type === t
                    ? 'border-aurora-400/50 bg-aurora-500/[0.12] text-white'
                    : 'border-white/[0.08] bg-white/[0.02] text-white/55 hover:border-white/20'
                )}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="qe-prompt" hint={`${form.prompt.length} chars`}>Prompt</Label>
          <TextArea id="qe-prompt" rows={3} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="qe-topic">Topic</Label>
            <Input id="qe-topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="qe-difficulty">Difficulty</Label>
            <Select id="qe-difficulty"
              value={form.difficulty}
              onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="qe-points">Points</Label>
            <Input id="qe-points"
              type="number"
              min={1}
              max={100}
              value={form.points}
              onChange={(e) => setForm({ ...form, points: Number(e.target.value) })}
            />
          </div>
        </div>

        {needsOptions && (
          <div>
            <GroupLabel id="qe-options" hint="click a circle to mark the correct option">Options</GroupLabel>
            <div role="group" aria-labelledby="qe-options" className="space-y-2">
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
                          correctOptionIndex: form.correctOptionIndex === i ? 0 : form.correctOptionIndex
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
                <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, options: [...form.options, ''] })}>
                  <Plus className="h-3.5 w-3.5" /> Add option
                </Button>
              )}
            </div>
          </div>
        )}

        {form.type === 'truefalse' && (
          <div>
            <GroupLabel id="qe-correct">Correct answer</GroupLabel>
            <div role="group" aria-labelledby="qe-correct" className="flex gap-2">
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
            <Label
              htmlFor="qe-accepted"
              hint={form.type === 'fill' ? 'one per line · typo tolerant' : 'one per line · used as the AI marking reference'}
            >
              {form.type === 'fill' ? 'Accepted answers' : 'Model answer / key points'}
            </Label>
            <TextArea id="qe-accepted"
              rows={form.type === 'long' ? 4 : 3}
              value={answers}
              onChange={(e) => setAnswers(e.target.value)}
              placeholder={
                form.type === 'long'
                  ? 'One key point per line — empty means AI marks from the prompt (or manual review if AI is off)'
                  : 'azimuthal\nangular momentum'
              }
            />
          </div>
        )}

        <div>
          <GroupLabel id="qe-timer" hint="seconds">Timer for this question</GroupLabel>
          <div role="group" aria-labelledby="qe-timer" className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={5}
              max={3600}
              value={form.timerSeconds}
              onChange={(e) => setForm({ ...form, timerSeconds: Number(e.target.value) })}
              className="w-[120px]"
            />
            {[20, 30, 45, 60, 120, 180, 300].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setForm({ ...form, timerSeconds: preset })}
                className={cx(
                  'rounded-lg border px-2 py-1 text-[11px] transition',
                  form.timerSeconds === preset
                    ? 'border-lime-400/40 bg-lime-400/10 text-lime-200'
                    : 'border-white/[0.08] text-white/45 hover:border-white/25 hover:text-white/80'
                )}
              >
                {preset}s
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="qe-explanation" hint="optional">Explanation</Label>
          <Input id="qe-explanation" value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
        </div>

        {error && (
          <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-3 py-2 text-[12px] text-ember-400">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
