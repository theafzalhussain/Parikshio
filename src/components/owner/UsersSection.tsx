'use client';

import { useEffect, useState } from 'react';
import { Ban, KeyRound, LogOut, Mail, Plus, RotateCcw, Save, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, SegmentedControl, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Badge, Panel } from '@/components/ui/Panel';
import { Avatar, GradePill, Loading, StatusPill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/lib/api';
import { ownerApi } from '@/lib/owner';
import type { GrantResult, OwnerUserDetail, OwnerUserRow, OwnerUsersPage } from '@shared/owner';
import { activityLabel } from './ActivitySection';
import {
  ago,
  ConfirmDialog,
  EmptyList,
  errorText,
  ErrorNote,
  Field,
  FilterTabs,
  fmtDate,
  fmtDateTime,
  mailto,
  Pager,
  roleLabel,
  SearchBox,
  useDebounced,
  useOwnerData
} from './common';

type Filter = 'all' | 'student' | 'admin' | 'suspended' | 'invited';

export function UsersSection({
  focusUserId,
  onFocusDone,
  onChanged
}: {
  focusUserId?: string;
  onFocusDone: () => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const q = useDebounced(search.trim());
  useEffect(() => setPage(1), [filter, q, sort]);
  useEffect(() => {
    if (focusUserId) {
      setOpenId(focusUserId);
      onFocusDone();
    }
  }, [focusUserId, onFocusDone]);

  const params = new URLSearchParams({ page: String(page), pageSize: '25', sort });
  if (filter === 'student' || filter === 'admin') params.set('role', filter);
  if (filter === 'suspended' || filter === 'invited') params.set('state', filter);
  if (q) params.set('search', q);
  const { data, error, loading, reload } = useOwnerData<OwnerUsersPage>(`/users?${params}`);

  const changed = () => {
    void reload();
    onChanged();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          label="Which accounts"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Everyone', count: data?.counts.all },
            { value: 'student', label: 'Students', count: data?.counts.students },
            { value: 'admin', label: 'Faculty', count: data?.counts.faculty },
            { value: 'invited', label: 'Invited', count: data?.counts.invited },
            { value: 'suspended', label: 'Suspended', count: data?.counts.suspended }
          ]}
        />
        <Button variant="gold" onClick={() => setAdding(true)} className="w-full sm:w-auto">
          <UserPlus className="h-4 w-4" /> Add faculty
        </Button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email or institute" label="Search accounts" />
        <div className="sm:ml-auto sm:w-48">
          <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort accounts" className="h-11">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="lastLogin">Last log-in</option>
            <option value="name">Name A–Z</option>
          </Select>
        </div>
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <Loading label="Loading accounts" />}
      {data && data.items.length === 0 && <EmptyList title="No accounts found" body="Try another filter or search." />}

      {data && data.items.length > 0 && (
        <ul className={cx('space-y-2.5 transition', loading && 'opacity-70')}>
          {data.items.map((u) => (
            <li key={u.id}>
              <UserRowCard user={u} onOpen={() => setOpenId(u.id)} />
            </li>
          ))}
        </ul>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      {openId && <UserPanel userId={openId} onClose={() => setOpenId(null)} onChanged={changed} />}
      <AddFacultyDialog open={adding} onClose={() => setAdding(false)} onDone={changed} />
    </div>
  );
}

function UserRowCard({ user, onOpen }: { user: OwnerUserRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-ring group grid w-full gap-3 rounded-2xl border border-white/[0.07] bg-ink-900/60 p-4 text-left transition hover:border-gold-200/25 hover:bg-ink-880/80 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] md:items-center"
    >
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={user.name} size={40} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14.5px] font-semibold text-white">{user.name}</span>
            <Badge tone={user.role === 'admin' ? 'gold' : 'neutral'}>{roleLabel(user.role)}</Badge>
            {user.suspended && <Badge tone="ember">suspended</Badge>}
            {user.invitePending && <Badge tone="amber">invite sent</Badge>}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-white/55">{user.email}</span>
          {user.org && <span className="block truncate text-[12.5px] text-white/40">{user.org}</span>}
        </span>
      </span>
      <span className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-white/55">
        {user.role === 'admin' ? (
          <>
            <span>
              <span className="num text-white/85">{user.sessionsCreated}</span> sessions
            </span>
            <span>
              <span className="num text-white/85">{user.questionsAuthored}</span> questions
            </span>
          </>
        ) : (
          <>
            <span>
              <span className="num text-white/85">{user.answers}</span> answers
            </span>
            <span>
              <span className="num text-white/85">{user.sessionsJoined}</span> sessions
            </span>
            <span>
              <span className="num text-white/85">{user.points}</span> points
            </span>
          </>
        )}
      </span>
      <span className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/40 md:flex-col md:items-end md:gap-1">
        <span>Joined {fmtDate(user.createdAt)}</span>
        <span>Last log-in {ago(user.lastLoginAt)}</span>
      </span>
    </button>
  );
}

function UserPanel({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const { push } = useToast();
  const { data, error, reload } = useOwnerData<OwnerUserDetail>(`/users/${encodeURIComponent(userId)}`);
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'student' | 'admin'>('student');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'delete' | 'suspend' | 'role'>(null);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setOrg(data.org);
    setEmail(data.email);
    setRole(data.role);
  }, [data]);

  const dirty = !!data && (name !== data.name || org !== data.org || email.trim().toLowerCase() !== data.email || role !== data.role);

  async function run(label: string, fn: () => Promise<unknown>, success: string, body?: string) {
    setBusy(label);
    try {
      await fn();
      push({ kind: 'success', title: success, body });
      await reload();
      onChanged();
      return true;
    } catch (err) {
      push({ kind: 'error', title: 'That did not work', body: errorText(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run(
      'save',
      () =>
        ownerApi(`/users/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          body: { name, org, email: email.trim(), role }
        }),
      'Account saved',
      data && role !== data.role ? 'They were logged out so the new role takes effect.' : undefined
    ).then(() => setConfirm(null));

  return (
    <>
      <Modal open onClose={onClose} title={data?.name ?? 'Account'} description={data?.email} width="max-w-3xl">
        {error && !data && <ErrorNote message={error} onRetry={reload} />}
        {!data && !error && <Loading label="Loading the account" />}
        {data && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={data.role === 'admin' ? 'gold' : 'neutral'}>{roleLabel(data.role)}</Badge>
              {data.suspended && <Badge tone="ember">suspended</Badge>}
              {data.invitePending && <Badge tone="amber">invite not accepted yet</Badge>}
              {data.google && <Badge tone="royal">Google</Badge>}
              {data.hasPassword && <Badge tone="neutral">password</Badge>}
              {data.emailVerified && <Badge tone="mint">email confirmed</Badge>}
            </div>

            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Joined">{fmtDate(data.createdAt)}</Field>
              <Field label="Last log-in">{data.lastLoginAt ? fmtDateTime(data.lastLoginAt) : 'never'}</Field>
              {data.role === 'admin' ? (
                <>
                  <Field label="Sessions made">{data.sessionsCreated}</Field>
                  <Field label="Questions written">{data.questionsAuthored}</Field>
                </>
              ) : (
                <>
                  <Field label="Answers">{data.answers}</Field>
                  <Field label="Points">{data.points}</Field>
                </>
              )}
            </dl>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
              <h3 className="font-display text-[17px] text-white">Details</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="u-name">Full name</Label>
                  <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                </div>
                <div>
                  <Label htmlFor="u-org">Institute / class</Label>
                  <Input id="u-org" value={org} onChange={(e) => setOrg(e.target.value)} maxLength={120} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="u-email" hint="They log in with this address">Email</Label>
                  <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} />
                </div>
                <div className="sm:col-span-2">
                  <p className="mb-2 text-[13.5px] font-medium text-white/85">Role</p>
                  <SegmentedControl
                    value={role}
                    onChange={setRole}
                    options={[
                      { value: 'student', label: 'Student' },
                      { value: 'admin', label: 'Faculty' }
                    ]}
                  />
                  {role !== data.role && (
                    <p className="mt-2 text-[12.5px] text-amber-200">
                      {role === 'admin'
                        ? 'Faculty can write questions, run sessions and see every result.'
                        : 'They lose access to the faculty console.'}{' '}
                      They will be logged out once you save.
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setName(data.name);
                    setOrg(data.org);
                    setEmail(data.email);
                    setRole(data.role);
                  }}
                  disabled={!dirty || !!busy}
                >
                  <RotateCcw className="h-4 w-4" /> Undo
                </Button>
                <Button
                  variant="gold"
                  onClick={() => (role !== data.role ? setConfirm('role') : void save())}
                  disabled={!dirty}
                  loading={busy === 'save'}
                >
                  <Save className="h-4 w-4" /> Save changes
                </Button>
              </div>
            </section>

            <section>
              <h3 className="font-display text-[17px] text-white">Actions</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <ActionButton
                  icon={Mail}
                  label="Email them"
                  body="Opens your mail app with their address"
                  href={mailto(data.email, 'Your Parikshio account')}
                />
                <ActionButton
                  icon={KeyRound}
                  label={data.invitePending ? 'Send the invite again' : 'Send a password reset link'}
                  body={data.invitePending ? 'A fresh “set your password” email' : 'They choose a new password from the email'}
                  busy={busy === 'reset'}
                  disabled={data.suspended}
                  onClick={() =>
                    data.invitePending
                      ? void run(
                          'reset',
                          () => ownerApi<GrantResult>('/faculty/grant', { method: 'POST', body: { email: data.email } }),
                          'Invite sent again'
                        )
                      : void run(
                          'reset',
                          () => ownerApi(`/users/${encodeURIComponent(userId)}/reset-link`, { method: 'POST' }),
                          'Reset link sent',
                          `It went to ${data.email} and works for 30 minutes.`
                        )
                  }
                />
                <ActionButton
                  icon={LogOut}
                  label="Log them out everywhere"
                  body="Ends every session on every device"
                  busy={busy === 'signout'}
                  onClick={() =>
                    void run('signout', () => ownerApi(`/users/${encodeURIComponent(userId)}/sign-out`, { method: 'POST' }), 'Logged out everywhere')
                  }
                />
                <ActionButton
                  icon={Ban}
                  label={data.suspended ? 'Reinstate account' : 'Suspend account'}
                  body={data.suspended ? 'They can log in again' : 'Blocks log-in; nothing is deleted'}
                  tone={data.suspended ? 'default' : 'warn'}
                  busy={busy === 'suspend'}
                  onClick={() =>
                    data.suspended
                      ? void run(
                          'suspend',
                          () => ownerApi(`/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { suspended: false } }),
                          'Account reinstated'
                        )
                      : setConfirm('suspend')
                  }
                />
                <ActionButton
                  icon={Trash2}
                  label="Delete account"
                  body={data.role === 'admin' ? 'Their sessions and questions stay' : 'Also removes their answers'}
                  tone="danger"
                  onClick={() => setConfirm('delete')}
                />
              </div>
            </section>

            {data.role === 'student' && data.recentAnswers.length > 0 && (
              <section>
                <h3 className="font-display text-[17px] text-white">Latest answers</h3>
                <ul className="mt-3 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07]">
                  {data.recentAnswers.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-white/85">
                        {a.examTitle} <span className="font-mono text-[11.5px] text-white/40">{a.examCode}</span>
                      </span>
                      <GradePill grade={a.grade} awarded={a.awarded} />
                      <span className="text-[12px] text-white/40">{ago(a.submittedAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.exams.length > 0 && (
              <section>
                <h3 className="font-display text-[17px] text-white">Their sessions</h3>
                <ul className="mt-3 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07]">
                  {data.exams.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <StatusPill status={e.status} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-white/85">{e.title}</span>
                      <span className="font-mono text-[11.5px] text-white/45">{e.code}</span>
                      <span className="text-[12px] text-white/40">{e.responses} answers</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="font-display text-[17px] text-white">Account activity</h3>
              {data.activity.length === 0 ? (
                <p className="mt-2 text-[13px] text-white/45">Nothing recorded yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07]">
                  {data.activity.map((a) => (
                    <li key={a.id} className="px-4 py-2.5">
                      <p className="text-[13px] text-white/85">
                        {activityLabel(a.action)} <span className="text-white/40">· {fmtDateTime(a.at)}</span>
                      </p>
                      {a.detail && <p className="mt-0.5 break-words text-[12px] text-white/45">{a.detail}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Modal>

      {/* Siblings of the panel, not children: a dialog inside the panel's animated box would be positioned and clipped by it. */}
      {data && (
        <>
          <ConfirmDialog
            open={confirm === 'role'}
            title={role === 'admin' ? 'Give faculty access?' : 'Remove faculty access?'}
            body={
              <p>
                {data.name} will {role === 'admin' ? 'get access to the faculty console' : 'become a student again'} and be
                logged out on every device. They log in again with the same email.
              </p>
            }
            confirmLabel={role === 'admin' ? 'Make faculty' : 'Make student'}
            busy={busy === 'save'}
            onConfirm={() => void save()}
            onClose={() => setConfirm(null)}
          />
          <ConfirmDialog
            open={confirm === 'suspend'}
            title="Suspend this account?"
            body={
              <p>
                {data.name} is logged out at once and cannot log in, use Google, or reset the password until you reinstate
                the account. Their data stays.
              </p>
            }
            confirmLabel="Suspend"
            danger
            busy={busy === 'suspend'}
            onConfirm={() =>
              void run(
                'suspend',
                () => ownerApi(`/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { suspended: true } }),
                'Account suspended'
              ).then(() => setConfirm(null))
            }
            onClose={() => setConfirm(null)}
          />
          <ConfirmDialog
            open={confirm === 'delete'}
            title="Delete this account for good?"
            body={
              <>
                <p>
                  This removes {data.name}&apos;s account
                  {data.role === 'student' ? ` and their ${data.answers} answers` : ''}. It cannot be undone.
                </p>
                {data.role === 'admin' && (
                  <p>Sessions and questions they made stay, so students keep their results.</p>
                )}
              </>
            }
            confirmLabel="Delete account"
            danger
            typeToConfirm={data.email}
            busy={busy === 'delete'}
            onConfirm={async () => {
              setBusy('delete');
              try {
                await ownerApi(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE', body: { confirm: data.email } });
                push({ kind: 'success', title: 'Account deleted', body: data.email });
                onChanged();
                onClose();
              } catch (err) {
                push({ kind: 'error', title: 'Could not delete', body: errorText(err) });
              } finally {
                setBusy(null);
              }
            }}
            onClose={() => setConfirm(null)}
          />
        </>
      )}
    </>
  );
}

function ActionButton({
  icon: Icon,
  label,
  body,
  onClick,
  href,
  busy,
  disabled,
  tone = 'default'
}: {
  icon: typeof Mail;
  label: string;
  body: string;
  onClick?: () => void;
  href?: string;
  busy?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const className = cx(
    'focus-ring flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45',
    tone === 'danger'
      ? 'border-ember-500/25 bg-ember-500/[0.05] hover:border-ember-500/50 hover:bg-ember-500/[0.1]'
      : tone === 'warn'
        ? 'border-amber-400/20 bg-amber-400/[0.04] hover:border-amber-400/45'
        : 'border-white/[0.08] bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]'
  );
  const content = (
    <>
      <span
        className={cx(
          'grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset',
          tone === 'danger'
            ? 'bg-ember-500/10 text-ember-300 ring-ember-500/30'
            : tone === 'warn'
              ? 'bg-amber-400/10 text-amber-200 ring-amber-400/25'
              : 'bg-gold-400/[0.08] text-gold-200 ring-gold-300/25'
        )}
      >
        {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className={cx('block text-[13.5px] font-semibold', tone === 'danger' ? 'text-ember-200' : 'text-white')}>{label}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-white/50">{body}</span>
      </span>
    </>
  );
  if (href) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={className}>
      {content}
    </button>
  );
}

export function AddFacultyDialog({
  open,
  onClose,
  onDone,
  initial
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  initial?: { email: string; name: string; org: string };
}) {
  const { push } = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail(initial?.email ?? '');
    setName(initial?.name ?? '');
    setOrg(initial?.org ?? '');
    setError(null);
  }, [open, initial]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await ownerApi<GrantResult>('/faculty/grant', { method: 'POST', body: { email, name, org } });
      push({
        kind: 'success',
        title: res.alreadyFaculty && !res.created ? 'Already faculty' : res.created ? 'Faculty account created' : 'Faculty access granted',
        body: res.created
          ? res.emailSent
            ? `An invite to choose a password went to ${res.user.email}.`
            : `The invite email could not be sent${res.devLink ? ` (development link: ${res.devLink})` : ''}.`
          : res.alreadyFaculty
            ? res.emailSent
              ? 'The invite was sent again.'
              : `${res.user.email} can already use the faculty console.`
            : res.emailSent
              ? `${res.user.email} was told by email.`
              : `${res.user.email} can now log in as faculty.`
      });
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a faculty member"
      description="If the email has no account yet, Parikshio creates one and emails a link to choose a password. An existing account is raised to faculty."
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="gold" onClick={() => void submit()} loading={busy} disabled={!email.trim()}>
            <Plus className="h-4 w-4" /> Give faculty access
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <Label htmlFor="f-email">Work email</Label>
          <Input id="f-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@college.edu" />
        </div>
        <div>
          <Label htmlFor="f-name" hint="For a new account">Full name</Label>
          <Input id="f-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Dr. Meera Sharma" />
        </div>
        <div>
          <Label htmlFor="f-org" hint="Optional">Institute</Label>
          <Input id="f-org" value={org} onChange={(e) => setOrg(e.target.value)} maxLength={120} />
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-ember-300">
            {error}
          </p>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
