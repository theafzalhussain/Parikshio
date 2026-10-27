'use client';

import { CircleAlert, CloudOff, CloudUpload, DatabaseBackup, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { Badge, Panel } from './ui/Panel';
import { Button } from './ui/Button';
import { cx, fmtRelative } from '@/lib/api';
import { discardAnswer, flushOutbox, type OutboxSnapshot } from '@/lib/offlineQueue';

/**
 * The student's view of the offline outbox: what is saved on this device, and
 * what is happening about it. Renders nothing while there is nothing to say.
 */
export function OfflineQueuePanel({ outbox, className }: { outbox: OutboxSnapshot; className?: string }) {
  const { online, syncing, pending, storage, ready } = outbox;
  const volatile = ready && storage === 'memory';

  if (online && pending.length === 0 && !volatile) return null;

  const tone = pending.length > 0 ? 'amber' : online ? 'neutral' : 'ember';

  return (
    <Panel
      className={cx(
        'overflow-hidden border-l-2 p-4',
        pending.length > 0 ? 'border-l-amber-400/70' : online ? 'border-l-white/20' : 'border-l-ember-500/70',
        className
      )}
    >
      {/* Connectivity changes are announced politely rather than interrupting. */}
      <div aria-live="polite" className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cx(
              'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1 ring-inset',
              pending.length > 0
                ? 'bg-amber-400/12 text-amber-300 ring-amber-400/25'
                : online
                  ? 'bg-white/[0.06] text-white/50 ring-white/10'
                  : 'bg-ember-500/12 text-ember-400 ring-ember-500/25'
            )}
          >
            {syncing ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : pending.length > 0 ? (
              <CloudUpload className="h-4 w-4" />
            ) : online ? (
              <DatabaseBackup className="h-4 w-4" />
            ) : (
              <WifiOff className="h-4 w-4" />
            )}
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold text-white">
                {pending.length > 0
                  ? syncing
                    ? 'Delivering your saved answers'
                    : `${pending.length} answer${pending.length > 1 ? 's' : ''} saved on this device`
                  : online
                    ? 'Offline backup unavailable'
                    : 'You are offline'}
              </p>
              <Badge tone={tone}>{online ? (syncing ? 'syncing' : 'queued') : 'offline'}</Badge>
            </div>

            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-white/45">
              {volatile
                ? 'This browser blocks local storage, so answers can only be held in memory — do not reload the page while you are offline.'
                : pending.length > 0
                  ? 'They are stored on this device and will be submitted automatically the moment the connection comes back. You can keep answering.'
                  : 'Keep answering — every submission is saved here first and sent automatically once you reconnect.'}
            </p>
          </div>
        </div>

        {pending.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            loading={syncing}
            onClick={() => void flushOutbox('student-retry')}
            className="shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Sync now
          </Button>
        )}
      </div>

      {pending.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {pending.map((record) => (
            <li
              key={record.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] text-white/75">
                  <span className="num mr-1.5 text-white/35">Q{record.questionIndex}</span>
                  {record.answer || '—'}
                </p>
                <p className="mt-0.5 text-[10.5px] text-white/30">
                  saved {fmtRelative(record.clientSubmittedAt)}
                  {record.attempts > 0 && ` · ${record.attempts} attempt${record.attempts > 1 ? 's' : ''}`}
                  {record.lastError && ` · ${record.lastError}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void discardAnswer(record.id)}
                className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] uppercase tracking-[0.12em] text-white/30 transition hover:bg-ember-500/10 hover:text-ember-400"
                aria-label={`Discard the saved answer for question ${record.questionIndex}`}
              >
                <Trash2 className="h-3 w-3" /> discard
              </button>
            </li>
          ))}
        </ul>
      )}

      {!online && pending.length === 0 && !volatile && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/30">
          <CloudOff className="h-3.5 w-3.5" />
          The question timer keeps running on the server while you are disconnected.
        </p>
      )}

      {volatile && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-300/70">
          <CircleAlert className="h-3.5 w-3.5" /> Storage: in-memory only
        </p>
      )}
    </Panel>
  );
}
