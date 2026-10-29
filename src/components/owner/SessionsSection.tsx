'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Loading, StatusPill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/lib/api';
import { ownerApi } from '@/lib/owner';
import type { OwnerExamRow, OwnerExamsPage } from '@shared/owner';
import {
  ago,
  ConfirmDialog,
  EmptyList,
  errorText,
  ErrorNote,
  FilterTabs,
  fmtDate,
  Pager,
  SearchBox,
  useDebounced,
  useOwnerData,
  type Navigate
} from './common';

type Filter = 'all' | 'live' | 'draft' | 'ended';

export function SessionsSection({ onChanged, navigate }: { onChanged: () => void; navigate: Navigate }) {
  const { push } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ kind: 'end' | 'delete'; exam: OwnerExamRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(search.trim());
  useEffect(() => setPage(1), [filter, q]);

  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (filter !== 'all') params.set('status', filter);
  if (q) params.set('search', q);
  const { data, error, loading, reload } = useOwnerData<OwnerExamsPage>(`/exams?${params}`);

  async function act() {
    if (!confirm) return;
    setBusy(true);
    try {
      const id = encodeURIComponent(confirm.exam.id);
      if (confirm.kind === 'end') {
        await ownerApi(`/exams/${id}/end`, { method: 'POST' });
        push({ kind: 'success', title: 'Session ended', body: `${confirm.exam.code} is closed for every student.` });
      } else {
        await ownerApi(`/exams/${id}`, { method: 'DELETE' });
        push({ kind: 'success', title: 'Session deleted', body: `${confirm.exam.code} and its answers are gone.` });
      }
      setConfirm(null);
      await reload();
      onChanged();
    } catch (err) {
      push({ kind: 'error', title: 'That did not work', body: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          label="Session status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: data?.counts.all },
            { value: 'live', label: 'Live', count: data?.counts.live },
            { value: 'draft', label: 'Draft', count: data?.counts.draft },
            { value: 'ended', label: 'Ended', count: data?.counts.ended }
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Search title, code or faculty" label="Search sessions" />
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <Loading label="Loading sessions" />}
      {data && data.items.length === 0 && <EmptyList title="No sessions here" body="Faculty create sessions in the faculty console." />}

      {data && data.items.length > 0 && (
        <ul className={cx('space-y-2.5 transition', loading && 'opacity-70')}>
          {data.items.map((e) => (
            <li
              key={e.id}
              className="grid gap-3 rounded-2xl border border-white/[0.07] bg-ink-900/60 p-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={e.status} />
                  <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[11.5px] tracking-[0.12em] text-white/70">{e.code}</span>
                </div>
                <p className="mt-1.5 truncate text-[14.5px] font-semibold text-white">{e.title}</p>
                <p className="truncate text-[12.5px] text-white/45">
                  {e.subject || 'No subject'} ·{' '}
                  <button
                    type="button"
                    onClick={() => navigate('users', { userId: e.adminId })}
                    className="focus-ring rounded underline-offset-4 hover:text-white/75 hover:underline"
                  >
                    {e.adminName}
                  </button>
                </p>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-white/55">
                <span>
                  <span className="num text-white/85">{e.questions}</span> questions
                </span>
                <span>
                  <span className="num text-white/85">{e.participants}</span> students
                </span>
                <span>
                  <span className="num text-white/85">{e.responses}</span> answers
                </span>
                <span className="w-full text-white/40">
                  Created {fmtDate(e.createdAt)}
                  {e.endedAt ? ` · ended ${ago(e.endedAt)}` : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <a
                  href={`/admin/exams/${encodeURIComponent(e.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] text-white/65 transition hover:bg-white/[0.06] hover:text-white"
                  title="Opens the faculty control room (needs a faculty log-in)"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Control room
                </a>
                {e.status !== 'ended' && (
                  <Button variant="secondary" size="sm" onClick={() => setConfirm({ kind: 'end', exam: e })}>
                    <Square className="h-3.5 w-3.5" /> End
                  </Button>
                )}
                <Button variant="danger" size="sm" onClick={() => setConfirm({ kind: 'delete', exam: e })} aria-label={`Delete ${e.title}`}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'end' ? `End ${confirm.exam.code}?` : `Delete ${confirm?.exam.code ?? ''}?`}
        body={
          confirm?.kind === 'end' ? (
            <p>
              “{confirm.exam.title}” closes for every student at once. Answers already given are kept and students can see
              their results.
            </p>
          ) : (
            <p>
              “{confirm?.exam.title}” is removed together with its {confirm?.exam.responses ?? 0} answers from{' '}
              {confirm?.exam.participants ?? 0} students. Its questions stay in the question bank. This cannot be undone.
            </p>
          )
        }
        confirmLabel={confirm?.kind === 'end' ? 'End session' : 'Delete session'}
        danger={confirm?.kind === 'delete'}
        typeToConfirm={confirm?.kind === 'delete' ? confirm.exam.code : undefined}
        busy={busy}
        onConfirm={() => void act()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
