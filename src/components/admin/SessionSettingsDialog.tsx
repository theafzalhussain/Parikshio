'use client';

import { useEffect, useState } from 'react';
import type { Exam, ExamSettings } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { GroupLabel, Input, Label, Toggle } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

/** Rename a session and change what students see while it runs and after it ends. */
export function SessionSettingsDialog({
  open,
  onClose,
  exam,
  settings,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  exam: Pick<Exam, 'id' | 'title' | 'subject'>;
  settings: ExamSettings;
  onSaved: () => void;
}) {
  const { push } = useToast();
  const [title, setTitle] = useState(exam.title);
  const [subject, setSubject] = useState(exam.subject);
  const [draft, setDraft] = useState<ExamSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(exam.title);
    setSubject(exam.subject);
    setDraft(settings);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/exams/${exam.id}`, { method: 'PATCH', body: { title, subject, settings: draft } });
      push({ kind: 'success', title: 'Session updated' });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the settings');
    } finally {
      setBusy(false);
    }
  }

  const setDefault = (key: keyof ExamSettings['setDefaults'], value: boolean) =>
    setDraft((d) => ({ ...d, setDefaults: { ...d.setDefaults, [key]: value } }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit session"
      description="Rename it and choose what students see. Changes apply immediately, including for students already in the room."
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" size="sm" loading={busy} onClick={save} disabled={!title.trim()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="settings-title">Session title</Label>
            <Input id="settings-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="settings-subject">Subject / cohort</Label>
            <Input id="settings-subject" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
          </div>
        </div>

        <div>
          <GroupLabel id="settings-students">What students see</GroupLabel>
          <div role="group" aria-labelledby="settings-students" className="grid gap-3 rounded-2xl border border-white/[0.08] bg-ink-950/40 p-4">
            <Toggle
              checked={draft.showLeaderboard}
              onChange={(v) => setDraft((d) => ({ ...d, showLeaderboard: v }))}
              label="Show the live leaderboard and ranks"
            />
            <Toggle
              checked={draft.revealAnswersAfterEnd}
              onChange={(v) => setDraft((d) => ({ ...d, revealAnswersAfterEnd: v }))}
              label="Reveal correct answers and explanations after the session ends"
            />
          </div>
        </div>

        <div>
          <GroupLabel id="settings-sets" hint="pre-selected when you push several questions">
            Defaults for question sets
          </GroupLabel>
          <div role="group" aria-labelledby="settings-sets" className="grid gap-3 rounded-2xl border border-white/[0.08] bg-ink-950/40 p-4">
            <Toggle
              checked={draft.setDefaults.revealPrompts}
              onChange={(v) => setDefault('revealPrompts', v)}
              label="Show question text before a student starts it"
            />
            <Toggle
              checked={draft.setDefaults.autoAdvance}
              onChange={(v) => setDefault('autoAdvance', v)}
              label="Start the next question automatically"
            />
            <Toggle
              checked={draft.setDefaults.allowSkip}
              onChange={(v) => setDefault('allowSkip', v)}
              label="Allow skipping a question"
            />
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-3.5 py-2.5 text-[13px] text-ember-300">{error}</p>
        )}
      </div>
    </Modal>
  );
}
