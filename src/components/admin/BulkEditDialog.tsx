'use client';

import { useEffect, useState } from 'react';
import type { Difficulty, Question } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { MAX_TIMER, MIN_TIMER } from '@/lib/time';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

/**
 * Apply the same timer, points, difficulty or topic to every selected
 * question. Blank fields are left untouched.
 */
export function BulkEditDialog({
  open,
  onClose,
  ids,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  ids: string[];
  onSaved: (updated: Question[]) => void;
}) {
  const { push } = useToast();
  const [timer, setTimer] = useState('');
  const [points, setPoints] = useState('');
  const [difficulty, setDifficulty] = useState<'' | Difficulty>('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTimer('');
    setPoints('');
    setDifficulty('');
    setTopic('');
    setError(null);
  }, [open]);

  const changed = timer !== '' || points !== '' || difficulty !== '' || topic.trim() !== '';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ updated: Question[]; failed: { id: string; error: string }[] }>('/questions/bulk-update', {
        method: 'POST',
        body: {
          ids,
          patch: {
            ...(timer !== '' ? { timerSeconds: Number(timer) } : {}),
            ...(points !== '' ? { points: Number(points) } : {}),
            ...(difficulty ? { difficulty } : {}),
            ...(topic.trim() ? { topic: topic.trim() } : {})
          }
        }
      });
      if (res.updated.length === 0 && res.failed.length) {
        setError(res.failed[0]!.error);
        return;
      }
      push({
        kind: res.failed.length ? 'warn' : 'success',
        title: `${res.updated.length} question${res.updated.length === 1 ? '' : 's'} updated`,
        body: res.failed.length ? `${res.failed.length} skipped: ${res.failed[0]!.error}` : undefined
      });
      onSaved(res.updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the questions');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${ids.length} question${ids.length === 1 ? '' : 's'}`}
      description="Fill in only what you want to change. Empty fields keep each question's current value."
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" size="sm" loading={busy} onClick={save} disabled={!changed}>
            Apply to {ids.length}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="bulk-edit-timer" hint={`${MIN_TIMER}–${MAX_TIMER}s`}>
            Timer (seconds)
          </Label>
          <Input
            id="bulk-edit-timer"
            type="number"
            min={MIN_TIMER}
            max={MAX_TIMER}
            value={timer}
            placeholder="keep"
            onChange={(e) => setTimer(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="bulk-edit-points">Points</Label>
          <Input
            id="bulk-edit-points"
            type="number"
            min={1}
            max={1000}
            value={points}
            placeholder="keep"
            onChange={(e) => setPoints(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="bulk-edit-difficulty">Difficulty</Label>
          <Select
            id="bulk-edit-difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as '' | Difficulty)}
          >
            <option value="">Keep as is</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="bulk-edit-topic">Topic</Label>
          <Input
            id="bulk-edit-topic"
            value={topic}
            maxLength={80}
            placeholder="keep"
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <p className="mt-4 rounded-xl border border-ember-500/30 bg-ember-500/10 px-3.5 py-2.5 text-[13px] text-ember-300">
          {error}
        </p>
      )}
    </Modal>
  );
}
