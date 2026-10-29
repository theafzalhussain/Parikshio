'use client';

import { useState } from 'react';
import { TriangleAlert, Trash2 } from 'lucide-react';
import type { AdminExamRow, ExamStatus } from '@shared/types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StatusPill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError } from '@/lib/api';

/** What the dialog needs to describe a session before it is deleted. */
export interface DeletableSession {
  id: string;
  title: string;
  code?: string;
  status: ExamStatus;
  students: number;
  answers: number;
}

/** A row from GET /api/exams, described for the delete dialog. */
export function sessionFromRow(exam: AdminExamRow): DeletableSession {
  return {
    id: exam.id,
    title: exam.title,
    code: exam.code,
    status: exam.status,
    students: exam.participation,
    answers: exam.responseCount
  };
}

interface DeleteResult {
  deleted: { id: string; responses: number; students: number }[];
  missing: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/**
 * Confirms and performs deleting one or many sessions. Says exactly what goes
 * (answers, students' results, analytics) and what stays (the questions).
 */
export function DeleteSessionsDialog({
  open,
  onClose,
  sessions,
  onDeleted
}: {
  open: boolean;
  onClose: () => void;
  sessions: DeletableSession[];
  onDeleted: (ids: string[]) => void;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = sessions.length;
  const answers = sessions.reduce((sum, s) => sum + s.answers, 0);
  const live = sessions.filter((s) => s.status === 'live').length;
  const single = count === 1 ? sessions[0] : null;

  function close() {
    if (busy) return;
    setError(null);
    onClose();
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = single
        ? await api<{ deleted: DeleteResult['deleted'][number] }>(`/exams/${single.id}`, { method: 'DELETE' }).then(
            (r): DeleteResult => ({ deleted: [r.deleted], missing: [] })
          )
        : await api<DeleteResult>('/exams/bulk-delete', { method: 'POST', body: { ids: sessions.map((s) => s.id) } });
      const removedAnswers = result.deleted.reduce((sum, d) => sum + d.responses, 0);
      push({
        kind: 'success',
        title: result.deleted.length === 1 ? 'Session deleted' : `${result.deleted.length} sessions deleted`,
        body: removedAnswers
          ? `${plural(removedAnswers, 'answer')} removed with ${result.deleted.length === 1 ? 'it' : 'them'}. Questions stay in your bank.`
          : 'Questions stay in your bank.'
      });
      onDeleted([...result.deleted.map((d) => d.id), ...result.missing]);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete right now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={single ? 'Delete this session?' : `Delete ${count} sessions?`}
      description={
        answers > 0
          ? `This removes ${plural(answers, 'answer')}, the students' results and the analytics for ${single ? 'this session' : 'these sessions'}. It cannot be undone. Questions stay in your bank.`
          : `${single ? 'The session' : 'These sessions'} will be removed. It cannot be undone. Questions stay in your bank.`
      }
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={busy} onClick={confirm} disabled={count === 0}>
            <Trash2 className="h-3.5 w-3.5" /> {single ? 'Delete session' : `Delete ${count} sessions`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {live > 0 && (
          <p className="flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-100">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            {live === count
              ? single
                ? 'This session is live. Students in the room are sent back to their lobby.'
                : 'These sessions are live. Students in the rooms are sent back to their lobby.'
              : `${plural(live, 'session')} ${live === 1 ? 'is' : 'are'} live. Students in ${live === 1 ? 'that room are' : 'those rooms are'} sent back to their lobby.`}
          </p>
        )}

        <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-white/90">{s.title}</p>
                <p className="mt-0.5 text-[12px] text-white/50">
                  {s.code ? <span className="font-mono tracking-[0.08em]">{s.code}</span> : null}
                  {s.code ? ' · ' : ''}
                  {plural(s.students, 'student')} · {plural(s.answers, 'answer')}
                </p>
              </div>
              <StatusPill status={s.status} />
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="rounded-xl border border-ember-500/30 bg-ember-500/10 px-3.5 py-2.5 text-[13px] text-ember-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
