'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, Check, Inbox, Mail, Save, Star, Trash2, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Label, Select, TextArea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/lib/api';
import { ownerApi } from '@/lib/owner';
import { CONTACT_TOPICS } from '@shared/contact';
import type { OwnerContactStatus, OwnerMessage, OwnerMessagesPage } from '@shared/owner';
import {
  ago,
  ConfirmDialog,
  EmptyList,
  errorText,
  ErrorNote,
  Field,
  FilterTabs,
  fmtDateTime,
  mailto,
  Pager,
  roleLabel,
  SearchBox,
  useDebounced,
  useOwnerData,
  type Navigate
} from './common';

type StatusFilter = OwnerContactStatus | 'all';

const topicTone = (topic: string) =>
  topic === 'faculty' ? 'gold' : topic === 'problem' ? 'ember' : topic === 'feedback' ? 'mint' : topic === 'onboarding' ? 'sky' : 'royal';

export function MessagesSection({
  focusId,
  onFocusDone,
  onChanged,
  navigate
}: {
  focusId?: string;
  onFocusDone: () => void;
  onChanged: () => void;
  navigate: Navigate;
}) {
  const [status, setStatus] = useState<StatusFilter>('new');
  const [topic, setTopic] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<OwnerMessage | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search.trim());
  useEffect(() => setPage(1), [status, topic, q]);
  useEffect(() => {
    if (!focusId) return;
    setStatus('all');
    setOpenId(focusId);
    onFocusDone();
  }, [focusId, onFocusDone]);

  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status !== 'all') params.set('status', status);
  if (topic) params.set('topic', topic);
  if (q) params.set('search', q);
  const { data, error, loading, reload } = useOwnerData<OwnerMessagesPage>(`/messages?${params}`);

  // A message picked on the overview opens once the list that holds it arrives.
  useEffect(() => {
    if (!openId || !data) return;
    const found = data.items.find((m) => m.id === openId);
    if (found) setOpen(found);
    setOpenId(null);
  }, [openId, data]);

  const changed = () => {
    void reload();
    onChanged();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          label="Message status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'new', label: 'New', count: data?.counts.new },
            { value: 'done', label: 'Done', count: data?.counts.done },
            { value: 'archived', label: 'Archived', count: data?.counts.archived },
            { value: 'all', label: 'All', count: data?.counts.all }
          ]}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email or text" label="Search messages" />
        <div className="sm:ml-auto sm:w-56">
          <Select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic" className="h-11">
            <option value="">All topics</option>
            {CONTACT_TOPICS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <Loading label="Loading messages" />}
      {data && data.items.length === 0 && (
        <EmptyList title={status === 'new' ? 'Inbox zero' : 'No messages here'} body="Messages from the contact page land here and in your email." />
      )}

      {data && data.items.length > 0 && (
        <ul className={cx('space-y-2.5 transition', loading && 'opacity-70')}>
          {data.items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setOpen(m)}
                className="focus-ring w-full rounded-2xl border border-white/[0.07] bg-ink-900/60 p-4 text-left transition hover:border-gold-200/25 hover:bg-ink-880/80"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={topicTone(m.topic)}>{m.topicLabel}</Badge>
                  {m.status === 'new' && <Badge tone="mint" dot>new</Badge>}
                  {m.status === 'archived' && <Badge tone="neutral">archived</Badge>}
                  {!m.delivered && (
                    <Badge tone="ember">
                      <AlertTriangle className="h-3 w-3" /> email to you failed
                    </Badge>
                  )}
                  <span className="ml-auto text-[11.5px] text-white/40">
                    {m.reference} · {ago(m.createdAt)}
                  </span>
                </span>
                <span className="mt-2 block text-[14.5px] font-semibold text-white">
                  {m.name} <span className="font-normal text-white/45">· {m.email}</span>
                </span>
                <span className="mt-1 line-clamp-2 block text-[13.5px] leading-relaxed text-white/60">{m.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      {open && (
        <MessageDialog
          message={open}
          onClose={() => setOpen(null)}
          onSaved={(m) => {
            setOpen(m);
            changed();
          }}
          onDeleted={() => {
            setOpen(null);
            changed();
          }}
          navigate={navigate}
        />
      )}
    </div>
  );
}

function MessageDialog({
  message,
  onClose,
  onSaved,
  onDeleted,
  navigate
}: {
  message: OwnerMessage;
  onClose: () => void;
  onSaved: (m: OwnerMessage) => void;
  onDeleted: () => void;
  navigate: Navigate;
}) {
  const { push } = useToast();
  const [note, setNote] = useState(message.note);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setNote(message.note), [message.id, message.note]);

  async function patch(label: string, body: Record<string, unknown>, title: string) {
    setBusy(label);
    try {
      const res = await ownerApi<{ message: OwnerMessage }>(`/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body });
      push({ kind: 'success', title });
      onSaved(res.message);
    } catch (err) {
      push({ kind: 'error', title: 'Could not save', body: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  const subject = `Re: ${message.topicLabel} (${message.reference})`;

  return (
    <>
      <Modal open onClose={onClose} title={`${message.topicLabel} from ${message.name}`} description={`${message.reference} · ${fmtDateTime(message.createdAt)}`} width="max-w-2xl">
        <div className="space-y-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              {message.name}
              <br />
              <a href={mailto(message.email, subject)} className="focus-ring break-all rounded text-gold-200 hover:text-gold-100">
                {message.email}
              </a>
            </Field>
            <Field label="They are">
              {message.roleLabel}
              {message.org ? ` · ${message.org}` : ''}
            </Field>
            {message.rating !== null && (
              <Field label="Rating">
                <span className="inline-flex items-center gap-0.5 text-gold-300" aria-label={`${message.rating} out of 5`}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} className={cx('h-4 w-4', i < message.rating! ? 'fill-current' : 'text-white/20')} />
                  ))}
                </span>
              </Field>
            )}
            <Field label="Account">
              {message.account ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate('users', { userId: message.account!.id });
                  }}
                  className="focus-ring rounded text-left underline-offset-4 hover:underline"
                >
                  {message.account.name} ({roleLabel(message.account.role)})
                </button>
              ) : (
                'No account with this email'
              )}
            </Field>
            <Field label="Emails">
              {message.delivered ? 'Sent to your inbox' : 'Email to your inbox failed'} ·{' '}
              {message.confirmationSent ? 'they got a copy' : 'no copy sent to them'}
            </Field>
            <Field label="Status">
              {message.status === 'new' ? 'New' : message.status === 'done' ? `Done ${message.resolvedAt ? `· ${fmtDateTime(message.resolvedAt)}` : ''}` : 'Archived'}
            </Field>
          </dl>

          <div className="whitespace-pre-wrap break-words rounded-2xl border border-white/[0.07] border-l-gold-300/60 bg-white/[0.02] px-4 py-3.5 text-[14px] leading-relaxed text-white/85" style={{ borderLeftWidth: 3 }}>
            {message.message}
          </div>

          {message.topic === 'faculty' && (
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate('requests', { messageId: message.id });
              }}
              className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-gold-300/25 bg-gold-400/[0.07] px-4 py-3 text-left text-[13.5px] text-gold-100 transition hover:border-gold-300/45"
            >
              <UserCheck className="h-4 w-4 shrink-0" />
              {message.facultyDecision ? `Faculty request ${message.facultyDecision}.` : 'This is a faculty access request.'} Open it in Faculty requests
            </button>
          )}

          <div>
            <Label htmlFor="msg-note" hint="Only you see this">Private note</Label>
            <TextArea id="msg-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="e.g. Replied on 30 Oct, waiting for their institute details" />
            <div className="mt-2 flex justify-end">
              <Button variant="secondary" size="sm" disabled={note === message.note} loading={busy === 'note'} onClick={() => void patch('note', { note }, 'Note saved')}>
                <Save className="h-3.5 w-3.5" /> Save note
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-white/[0.07] pt-5">
            <a
              href={mailto(message.email, subject)}
              className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-b from-gold-200 via-gold-300 to-gold-500 px-5 text-[14px] font-semibold text-ink-950"
            >
              <Mail className="h-4 w-4" /> Reply by email
            </a>
            {message.status !== 'done' && (
              <Button variant="secondary" loading={busy === 'done'} onClick={() => void patch('done', { status: 'done' }, 'Marked as done')}>
                <Check className="h-4 w-4" /> Mark done
              </Button>
            )}
            {message.status !== 'archived' && (
              <Button variant="secondary" loading={busy === 'archived'} onClick={() => void patch('archived', { status: 'archived' }, 'Archived')}>
                <Archive className="h-4 w-4" /> Archive
              </Button>
            )}
            {message.status !== 'new' && (
              <Button variant="ghost" loading={busy === 'new'} onClick={() => void patch('new', { status: 'new' }, 'Moved back to New')}>
                <Inbox className="h-4 w-4" /> Mark new
              </Button>
            )}
            <Button variant="danger" className="sm:ml-auto" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this message?"
        body={<p>The message from {message.name} is removed from the database. The copy in your email inbox stays.</p>}
        confirmLabel="Delete message"
        danger
        busy={busy === 'delete'}
        onConfirm={async () => {
          setBusy('delete');
          try {
            await ownerApi(`/messages/${encodeURIComponent(message.id)}`, { method: 'DELETE' });
            push({ kind: 'success', title: 'Message deleted' });
            setConfirmDelete(false);
            onDeleted();
          } catch (err) {
            push({ kind: 'error', title: 'Could not delete', body: errorText(err) });
          } finally {
            setBusy(null);
          }
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
