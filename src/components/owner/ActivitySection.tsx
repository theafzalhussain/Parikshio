'use client';

import { useEffect, useState } from 'react';
import { Badge, Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Pills';
import type { OwnerAuditRow, Paged } from '@shared/owner';
import { ErrorNote, FilterTabs, fmtDateTime, Pager, SearchBox, useDebounced, useOwnerData, EmptyList } from './common';

const LABELS: Record<string, string> = {
  'auth.login': 'Logged in',
  'auth.login_failed': 'Failed log-in',
  'auth.register': 'Signed up',
  'auth.google_login': 'Logged in with Google',
  'auth.google_register': 'Signed up with Google',
  'auth.google_failed': 'Failed Google sign-in',
  'auth.forgot_requested': 'Asked for a password reset',
  'auth.forgot_unknown': 'Reset for unknown email',
  'auth.forgot_email_sent': 'Reset email sent',
  'auth.forgot_email_failed': 'Reset email failed',
  'auth.reset_completed': 'Password reset',
  'auth.reset_failed': 'Reset link refused',
  'auth.change_password': 'Changed password',
  'auth.change_password_failed': 'Wrong current password',
  'contact.received': 'Contact form message',
  'contact.spam_dropped': 'Spam message dropped',
  'exams.delete': 'Faculty deleted sessions',
  'security.rate_limited': 'Rate limit hit',
  'owner.login': 'Owner signed in',
  'owner.login_failed': 'Owner sign-in failed',
  'owner.logout': 'Owner signed out',
  'owner.code_sent': 'Owner code sent',
  'owner.code_refused': 'Code asked for non-owner email',
  'owner.code_email_failed': 'Owner code email failed',
  'owner.sessions_revoked': 'Owner sign-ins ended',
  'owner.user_updated': 'Owner edited an account',
  'owner.user_deleted': 'Owner deleted an account',
  'owner.user_signed_out': 'Owner signed an account out',
  'owner.reset_link_sent': 'Owner sent a reset link',
  'owner.faculty_granted': 'Faculty access granted',
  'owner.faculty_invited': 'Faculty invited',
  'owner.faculty_declined': 'Faculty request declined',
  'owner.message_updated': 'Message updated',
  'owner.message_deleted': 'Message deleted',
  'owner.exam_ended': 'Owner ended a session',
  'owner.exam_deleted': 'Owner deleted a session',
  'owner.test_email': 'Test email sent'
};

export function activityLabel(action: string): string {
  return LABELS[action] ?? action.replace(/[._]/g, ' ');
}

function tone(action: string): 'ember' | 'gold' | 'mint' | 'neutral' | 'royal' {
  if (/failed|refused|rate_limited|spam|deleted/.test(action)) return 'ember';
  if (action.startsWith('owner.')) return 'gold';
  if (/login|register/.test(action)) return 'mint';
  if (action.startsWith('contact.')) return 'royal';
  return 'neutral';
}

type Kind = 'all' | 'owner' | 'auth' | 'contact' | 'exams' | 'security';

export function ActivitySection() {
  const [kind, setKind] = useState<Kind>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  useEffect(() => setPage(1), [kind, q]);

  const params = new URLSearchParams({ page: String(page), pageSize: '50' });
  if (kind !== 'all') params.set('kind', kind);
  if (q) params.set('search', q);
  const { data, error, loading, reload } = useOwnerData<Paged<OwnerAuditRow>>(`/audit?${params}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          label="Kind of activity"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'owner', label: 'Owner' },
            { value: 'auth', label: 'Log-ins & accounts' },
            { value: 'contact', label: 'Contact form' },
            { value: 'exams', label: 'Sessions' },
            { value: 'security', label: 'Security' }
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Search email, IP or detail" label="Search activity" />
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <Loading label="Loading activity" />}

      {data && (
        <Panel className={loading ? 'p-2 opacity-70 transition sm:p-3' : 'p-2 transition sm:p-3'}>
          {data.items.length === 0 ? (
            <EmptyList title="Nothing here" body="No recorded activity matches this filter." />
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {data.items.map((a) => (
                <li key={a.id} className="grid gap-1.5 px-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:gap-4">
                  <span className="text-[12px] text-white/45">{fmtDateTime(a.at)}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone(a.action)} className="max-w-full !whitespace-normal text-left">
                        {activityLabel(a.action)}
                      </Badge>
                      <span className="min-w-0 break-all text-[13px] text-white/75">{a.actorName}</span>
                    </div>
                    {a.detail && <p className="mt-1 break-words text-[12.5px] leading-relaxed text-white/50">{a.detail}</p>}
                    <p className="mt-0.5 font-mono text-[11px] text-white/30">IP {a.ip}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      <p className="text-[12px] text-white/35">The log keeps the latest 2,000 events.</p>
    </div>
  );
}
