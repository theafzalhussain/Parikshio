'use client';

import { useEffect, useState } from 'react';
import { Check, Mail, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/lib/api';
import { ownerApi } from '@/lib/owner';
import type { GrantResult, OwnerMessage, OwnerRequestsPage } from '@shared/owner';
import {
  ago,
  ConfirmDialog,
  EmptyList,
  errorText,
  ErrorNote,
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

type State = 'pending' | 'approved' | 'declined' | 'all';

/**
 * Faculty access requests from the contact form. Approving gives the address
 * faculty access: an existing account is raised to faculty, otherwise a new
 * faculty account is made and the teacher is emailed a link to set a password.
 */
export function RequestsSection({
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
  const { push } = useToast();
  const [state, setState] = useState<State>('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ kind: 'approve' | 'decline'; request: OwnerMessage } | null>(null);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const q = useDebounced(search.trim());
  useEffect(() => setPage(1), [state, q]);
  useEffect(() => {
    if (!focusId) return;
    setState('all');
    setHighlight(focusId);
    onFocusDone();
  }, [focusId, onFocusDone]);

  const params = new URLSearchParams({ page: String(page), pageSize: '20', state });
  if (q) params.set('search', q);
  const { data, error, loading, reload } = useOwnerData<OwnerRequestsPage>(`/requests?${params}`);

  useEffect(() => {
    if (!highlight || !data) return;
    document.getElementById(`req-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight, data]);

  async function decide() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'approve') {
        const res = await ownerApi<GrantResult>(`/requests/${encodeURIComponent(confirm.request.id)}/approve`, { method: 'POST' });
        push({
          kind: 'success',
          title: res.created ? 'Faculty account created' : res.alreadyFaculty ? 'Already faculty' : 'Faculty access granted',
          body: res.created
            ? res.emailSent
              ? `${res.user.email} got an email to choose a password.`
              : `The invite email could not be sent${res.devLink ? ` (development link: ${res.devLink})` : ''}.`
            : res.emailSent
              ? `${res.user.email} was told by email.`
              : `${res.user.email} can log in as faculty.`
        });
      } else {
        await ownerApi(`/requests/${encodeURIComponent(confirm.request.id)}/decline`, { method: 'POST' });
        push({ kind: 'info', title: 'Request declined', body: 'Reply to them by email if you want to explain why.' });
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

  async function reopen(request: OwnerMessage) {
    try {
      await ownerApi(`/messages/${encodeURIComponent(request.id)}`, { method: 'PATCH', body: { reopenDecision: true } });
      push({ kind: 'info', title: 'Request reopened', body: 'Access already given stays until you change the account.' });
      await reload();
      onChanged();
    } catch (err) {
      push({ kind: 'error', title: 'That did not work', body: errorText(err) });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          label="Request state"
          value={state}
          onChange={setState}
          options={[
            { value: 'pending', label: 'Waiting', count: data?.counts.pending },
            { value: 'approved', label: 'Approved', count: data?.counts.approved },
            { value: 'declined', label: 'Declined', count: data?.counts.declined },
            { value: 'all', label: 'All' }
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email or institute" label="Search requests" />
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <Loading label="Loading requests" />}
      {data && data.items.length === 0 && (
        <EmptyList
          title={state === 'pending' ? 'No requests waiting' : 'Nothing here'}
          body="Teachers ask for access with the “Faculty access” topic on the contact page. You can also add faculty directly from Users."
        />
      )}

      {data && data.items.length > 0 && (
        <ul className={cx('space-y-3 transition', loading && 'opacity-70')}>
          {data.items.map((r) => (
            <li
              key={r.id}
              id={`req-${r.id}`}
              className={cx(
                'rounded-2xl border bg-ink-900/60 p-4 transition sm:p-5',
                highlight === r.id ? 'border-gold-300/50 shadow-[0_0_0_3px_rgba(223,184,115,0.12)]' : 'border-white/[0.07]'
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-white">{r.name}</p>
                  <a href={mailto(r.email, `Re: Faculty access (${r.reference})`)} className="focus-ring break-all rounded text-[13.5px] text-gold-200 hover:text-gold-100">
                    {r.email}
                  </a>
                  <p className="mt-0.5 text-[12.5px] text-white/45">
                    {[r.org, r.roleLabel].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 text-right">
                  {r.facultyDecision === 'approved' && <Badge tone="mint">approved</Badge>}
                  {r.facultyDecision === 'declined' && <Badge tone="ember">declined</Badge>}
                  {!r.facultyDecision && <Badge tone="gold">waiting</Badge>}
                  <span className="text-[11.5px] text-white/40" title={fmtDateTime(r.createdAt)}>
                    {r.reference} · {ago(r.createdAt)}
                  </span>
                </div>
              </div>

              <p className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[13.5px] leading-relaxed text-white/75">
                {r.message}
              </p>

              <p className="mt-3 text-[12.5px] text-white/55">
                {r.account ? (
                  <>
                    Account:{' '}
                    <button
                      type="button"
                      onClick={() => navigate('users', { userId: r.account!.id })}
                      className="focus-ring rounded font-medium text-white/85 underline-offset-4 hover:underline"
                    >
                      {r.account.name}
                    </button>{' '}
                    ({roleLabel(r.account.role)}
                    {r.account.suspended ? ', suspended' : ''})
                  </>
                ) : (
                  'No account with this email yet — approving creates one and emails a link to set a password.'
                )}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {!r.facultyDecision ? (
                  <>
                    <Button
                      variant="gold"
                      size="sm"
                      onClick={() => setConfirm({ kind: 'approve', request: r })}
                      disabled={!!r.account?.suspended}
                      title={r.account?.suspended ? 'Reinstate the account first (Users)' : undefined}
                    >
                      <Check className="h-4 w-4" /> Approve
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirm({ kind: 'decline', request: r })}>
                      <X className="h-4 w-4" /> Decline
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void reopen(r)}>
                    <RotateCcw className="h-4 w-4" /> Reopen
                  </Button>
                )}
                <a
                  href={mailto(r.email, `Re: Faculty access (${r.reference})`)}
                  className="focus-ring inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-medium text-white/70 transition hover:bg-white/[0.06] hover:text-white"
                >
                  <Mail className="h-4 w-4" /> Reply
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'approve' ? `Give ${confirm.request.name} faculty access?` : 'Decline this request?'}
        body={
          confirm?.kind === 'approve' ? (
            confirm.request.account ? (
              confirm.request.account.role === 'admin' ? (
                <p>{confirm.request.email} already has faculty access. The request will be marked approved.</p>
              ) : (
                <p>
                  The existing account {confirm.request.email} becomes faculty. They are logged out once and get an email
                  saying they can log in as faculty.
                </p>
              )
            ) : (
              <p>
                A faculty account is created for {confirm.request.email}, and they get an email with a link to choose a
                password (valid for 7 days). They can also use “Continue with Google” with that address.
              </p>
            )
          ) : (
            <p>
              The request is marked declined. No email is sent; use Reply if you want to tell {confirm?.request.name} why.
            </p>
          )
        }
        confirmLabel={confirm?.kind === 'approve' ? 'Approve' : 'Decline'}
        danger={confirm?.kind === 'decline'}
        busy={busy}
        onConfirm={() => void decide()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
