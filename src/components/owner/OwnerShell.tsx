'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  UserCheck,
  Users,
  X
} from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { cx } from '@/lib/api';
import { useDialog } from '@/lib/useDialog';
import type { OwnerOverview } from '@shared/owner';
import { ActivitySection } from './ActivitySection';
import { useOwnerData, type Navigate, type SectionKey } from './common';
import { MessagesSection } from './MessagesSection';
import { OverviewSection } from './OverviewSection';
import { RequestsSection } from './RequestsSection';
import { SessionsSection } from './SessionsSection';
import { SettingsSection } from './SettingsSection';
import { UsersSection } from './UsersSection';

const SECTIONS: { key: SectionKey; label: string; sub: string; icon: typeof Inbox }[] = [
  { key: 'overview', label: 'Overview', sub: 'Everything on Parikshio at a glance', icon: LayoutDashboard },
  { key: 'requests', label: 'Faculty requests', sub: 'Teachers asking for faculty access', icon: UserCheck },
  { key: 'users', label: 'Users', sub: 'Every student and faculty account', icon: Users },
  { key: 'messages', label: 'Messages', sub: 'Everything sent through the contact page', icon: Inbox },
  { key: 'sessions', label: 'Sessions', sub: 'Every exam session on the platform', icon: Radio },
  { key: 'activity', label: 'Activity', sub: 'Log-ins, changes and security events', icon: ScrollText },
  { key: 'settings', label: 'Settings', sub: 'Your sign-ins, email and server status', icon: Settings2 }
];

const isSection = (value: string): value is SectionKey => SECTIONS.some((s) => s.key === value);

export function OwnerShell({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [section, setSection] = useState<SectionKey>('overview');
  const [focus, setFocus] = useState<{ userId?: string; messageId?: string }>({});
  /** Bumped after any change: refreshes the menu badges. */
  const [badgeKey, setBadgeKey] = useState(0);
  /** Bumped by the Refresh button: reloads the open section from scratch. */
  const [reloadKey, setReloadKey] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const drawerRef = useDialog<HTMLDivElement>(drawer, closeDrawer);

  // The section lives in the URL hash (/hq#users), so reloads and the back button keep it.
  useEffect(() => {
    const read = () => {
      const key = window.location.hash.slice(1);
      setSection(isSection(key) ? key : 'overview');
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const navigate: Navigate = useCallback((key, f) => {
    setFocus(f ?? {});
    setSection(key);
    setDrawer(false);
    if (window.location.hash !== `#${key}`) window.history.pushState(null, '', `#${key}`);
    window.scrollTo({ top: 0 });
  }, []);
  const clearFocus = useCallback(() => setFocus({}), []);
  const changed = useCallback(() => setBadgeKey((k) => k + 1), []);
  const refreshAll = useCallback(() => {
    setReloadKey((k) => k + 1);
    setBadgeKey((k) => k + 1);
  }, []);

  // Badge counts for the menu; refreshed after every change and once a minute.
  const counts = useOwnerData<OwnerOverview>(`/overview?badge=${badgeKey}`);
  const { reload: reloadCounts } = counts;
  useEffect(() => {
    const t = window.setInterval(() => void reloadCounts(), 60_000);
    return () => window.clearInterval(t);
  }, [reloadCounts]);
  const badges: Partial<Record<SectionKey, number>> = {
    requests: counts.data?.messages.facultyPending,
    messages: counts.data?.messages.new
  };

  const current = SECTIONS.find((s) => s.key === section)!;

  const nav = (
    <nav aria-label="Owner console" className="flex flex-col gap-1">
      {SECTIONS.map((item) => {
        const active = item.key === section;
        const badge = badges[item.key];
        return (
          <a
            key={item.key}
            href={`#${item.key}`}
            onClick={(e) => {
              e.preventDefault();
              navigate(item.key);
            }}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition duration-200 focus-ring',
              active
                ? 'bg-gradient-to-r from-gold-300/[0.13] via-white/[0.035] to-transparent text-white ring-1 ring-inset ring-gold-200/[0.14]'
                : 'text-white/60 hover:bg-white/[0.045] hover:text-white'
            )}
          >
            {active && (
              <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-gold-200 to-gold-500" />
            )}
            <item.icon className={cx('h-[18px] w-[18px] transition', active ? 'text-gold-300' : 'text-white/40 group-hover:text-white/75')} />
            <span className="flex-1">{item.label}</span>
            {!!badge && (
              <span className="num rounded-full bg-gold-400/20 px-2 py-0.5 text-[11px] font-semibold text-gold-100 ring-1 ring-inset ring-gold-300/30">
                {badge}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );

  const brand = (
    <a href="#overview" onClick={(e) => { e.preventDefault(); navigate('overview'); }} className="focus-ring flex items-center gap-3 rounded-xl">
      <LogoMark className="h-10 w-10 shrink-0" />
      <span className="leading-none">
        <span className="block font-display text-[21px] font-semibold text-white">Parikshio</span>
        <span className="mt-1 block text-[9.5px] font-semibold uppercase tracking-[0.3em] text-gold-200/75">Owner console</span>
      </span>
    </a>
  );

  const ownerCard = (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-400/[0.1] text-gold-200 ring-1 ring-inset ring-gold-300/30">
        <ShieldCheck className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white">{email}</p>
        <p className="text-[11.5px] text-gold-200/70">Owner</p>
      </div>
      <button onClick={onSignOut} className="focus-ring rounded-lg p-2 text-white/45 transition hover:bg-white/[0.06] hover:text-ember-300" aria-label="Sign out of the owner console" title="Sign out">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 grid-veil opacity-50" />
        <div className="aura aura-royal -left-40 -top-24 h-[30rem] w-[30rem]" />
        <div className="aura aura-gold -bottom-24 right-0 h-[26rem] w-[26rem]" />
      </div>

      <div className="mx-auto flex max-w-[1560px]">
        <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col border-r border-white/[0.07] bg-gradient-to-b from-ink-900/80 to-ink-950/60 px-4 py-6 lg:flex">
          <div className="px-1.5">{brand}</div>
          <p className="eyebrow mb-3 mt-9 px-3.5 text-[10.5px]">Manage</p>
          <div className="flex-1 overflow-y-auto">{nav}</div>
          {ownerCard}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  onClick={() => setDrawer(true)}
                  className="focus-ring rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-white/70 transition hover:border-white/25 hover:text-white lg:hidden"
                  aria-label="Open menu"
                  aria-expanded={drawer}
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate font-display text-[21px] font-medium leading-tight text-white sm:text-[24px]">{current.label}</h1>
                  <p className="mt-1 truncate text-[13px] text-white/55">{current.sub}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden items-center gap-2 rounded-full border border-gold-300/25 bg-gold-400/[0.07] px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-gold-200 md:inline-flex">
                  <ShieldCheck className="h-3.5 w-3.5" /> Owner
                </span>
                <button
                  onClick={refreshAll}
                  className="focus-ring grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/65 transition hover:border-white/25 hover:text-white"
                  aria-label="Refresh"
                  title="Refresh"
                >
                  <RefreshCw className={cx('h-4 w-4', counts.loading && 'animate-spin')} />
                </button>
              </div>
            </div>
          </header>

          <main id="main" className="px-4 py-6 sm:px-8 sm:py-8">
            {/* Remounting on Refresh reloads whatever the section shows. */}
            <div key={`${section}-${reloadKey}`} className="animate-fadeIn">
              {section === 'overview' && <OverviewSection navigate={navigate} refreshKey={reloadKey} />}
              {section === 'requests' && (
                <RequestsSection focusId={focus.messageId} onFocusDone={clearFocus} onChanged={changed} navigate={navigate} />
              )}
              {section === 'users' && <UsersSection focusUserId={focus.userId} onFocusDone={clearFocus} onChanged={changed} />}
              {section === 'messages' && (
                <MessagesSection focusId={focus.messageId} onFocusDone={clearFocus} onChanged={changed} navigate={navigate} />
              )}
              {section === 'sessions' && <SessionsSection onChanged={changed} navigate={navigate} />}
              {section === 'activity' && <ActivitySection />}
              {section === 'settings' && <SettingsSection onSignedOut={onSignOut} />}
            </div>
          </main>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div className="absolute inset-0 animate-fadeIn bg-ink-950/80 backdrop-blur-sm" onClick={closeDrawer} aria-hidden="true" />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Owner menu"
            className="relative flex h-full w-[284px] max-w-[85vw] animate-slideInLeft flex-col border-r border-white/10 bg-ink-900 px-4 py-5 shadow-lift"
          >
            <div className="flex items-center justify-between px-1">
              {brand}
              <button onClick={closeDrawer} className="focus-ring rounded-lg p-2 text-white/60 transition hover:bg-white/[0.06] hover:text-white" aria-label="Close menu">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="eyebrow mb-3 mt-8 px-3.5 text-[10.5px]">Manage</p>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            <div className="mt-4">{ownerCard}</div>
          </div>
        </div>
      )}
    </div>
  );
}
