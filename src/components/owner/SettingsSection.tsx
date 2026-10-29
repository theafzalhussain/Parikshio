'use client';

import { useState } from 'react';
import { LogOut, MailCheck, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { ownerApi } from '@/lib/owner';
import type { OwnerSessionRow, OwnerSystem } from '@shared/owner';
import { ago, errorText, ErrorNote, Field, fmtDateTime, useOwnerData } from './common';

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

/** A short device description from a user-agent string. */
function device(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SettingsSection({ onSignedOut }: { onSignedOut: () => void }) {
  const { push } = useToast();
  const system = useOwnerData<OwnerSystem>('/system');
  const sessions = useOwnerData<{ items: OwnerSessionRow[] }>('/sessions');
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>, title: string, body?: string) {
    setBusy(label);
    try {
      await fn();
      push({ kind: 'success', title, body });
      await sessions.reload();
    } catch (err) {
      push({ kind: 'error', title: 'That did not work', body: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  const s = system.data;
  const others = sessions.data?.items.filter((x) => !x.current).length ?? 0;

  return (
    <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
      <Panel className="p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4 text-gold-300" />
          <h2 className="font-display text-[19px] text-white">Owner sign-ins</h2>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
          Each sign-in lasts 12 hours. End any you do not recognise, then check who can read your owner inbox.
        </p>
        {sessions.error && <div className="mt-4"><ErrorNote message={sessions.error} onRetry={sessions.reload} /></div>}
        {!sessions.data && !sessions.error && <Loading label="Loading sign-ins" />}
        {sessions.data && (
          <ul className="mt-4 space-y-2">
            {sessions.data.items.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-white">
                    {device(x.userAgent)} {x.current && <Badge tone="mint">this device</Badge>}
                  </p>
                  <p className="mt-0.5 break-words text-[12px] leading-relaxed text-white/45">
                    {x.email} · IP {x.ip} · signed in {ago(x.createdAt)} · active {ago(x.lastSeenAt)}
                  </p>
                </div>
                {!x.current && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === x.id}
                    onClick={() => void run(x.id, () => ownerApi(`/sessions/${encodeURIComponent(x.id)}/revoke`, { method: 'POST' }), 'Signed out that device')}
                  >
                    End
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!others}
            loading={busy === 'others'}
            onClick={() => void run('others', () => ownerApi('/sessions/revoke-others', { method: 'POST' }), 'Other devices signed out')}
          >
            End all other sign-ins
          </Button>
          <Button
            variant="danger"
            loading={busy === 'logout'}
            onClick={async () => {
              setBusy('logout');
              try {
                await ownerApi('/auth/logout', { method: 'POST' });
              } catch {
                /* signing out locally is what matters */
              }
              onSignedOut();
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </Panel>

      <Panel className="p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <MailCheck className="h-4 w-4 text-gold-300" />
          <h2 className="font-display text-[19px] text-white">Email</h2>
        </div>
        {system.error && <div className="mt-4"><ErrorNote message={system.error} onRetry={system.reload} /></div>}
        {!s && !system.error && <Loading label="Loading" />}
        {s && (
          <>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Sending">
                <Badge tone={s.email.enabled ? 'mint' : 'ember'} dot>
                  {s.email.enabled ? 'on' : 'off'}
                </Badge>
              </Field>
              <Field label="Sender">
                {s.email.senderName} &lt;{s.email.senderEmail || 'not set'}&gt;
              </Field>
              <Field label="Contact form inbox">{s.email.inbox}</Field>
              <Field label="Owner codes go to">{s.ownerEmails.join(', ')}</Field>
            </dl>
            <p className="mt-4 text-[12.5px] leading-relaxed text-white/50">
              Brevo accepts an email first and checks the sender afterwards, so a test that is “accepted” can still fail to
              arrive if the sender is not verified in Brevo. Check your inbox (and spam).
            </p>
            <Button
              className="mt-4"
              variant="gold"
              disabled={!s.email.enabled}
              loading={busy === 'test'}
              onClick={() =>
                void run(
                  'test',
                  () => ownerApi('/system/test-email', { method: 'POST' }),
                  'Test email accepted',
                  'Look for “Parikshio test email” in your owner inbox.'
                )
              }
            >
              <MailCheck className="h-4 w-4" /> Send me a test email
            </Button>
          </>
        )}
      </Panel>

      <Panel className="p-5 sm:p-6 xl:col-span-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-gold-300" />
          <h2 className="font-display text-[19px] text-white">Server</h2>
        </div>
        {s && (
          <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="Environment">{s.environment}</Field>
            <Field label="Running for">{uptime(s.uptimeSeconds)}</Field>
            <Field label="Started">{fmtDateTime(s.bootedAt)}</Field>
            <Field label="Version">{s.commit ?? '—'}</Field>
            <Field label="Database">
              <Badge tone={s.mongo === 'connected' ? 'mint' : 'ember'} dot className="max-w-full !whitespace-normal">
                {s.mongo === 'connected' ? 'connected' : 'memory only'}
              </Badge>
            </Field>
            <Field label="Cache">{s.redis}</Field>
            <Field label="AI grading">{s.ai.enabled ? s.ai.models.join(' → ') : 'off'}</Field>
            <Field label="Google sign-in">{s.googleSignIn ? 'on' : 'off'}</Field>
            <Field label="Google Classroom">{s.classroom ? 'on' : 'off'}</Field>
            <Field label="Links in emails">{s.appUrl || 'this server'}</Field>
            <div className="col-span-2">
              <Field label="Sites allowed to call the API">{s.allowedOrigins.length ? s.allowedOrigins.join(', ') : 'same site only'}</Field>
            </div>
          </dl>
        )}
        <p className="mt-5 text-[12.5px] leading-relaxed text-white/45">
          Who can open this console is set by <span className="font-mono text-white/70">OWNER_EMAILS</span> on the server
          (Render → Environment). Nothing here can change it, so a stolen sign-in cannot add a new owner.
        </p>
      </Panel>
    </div>
  );
}
