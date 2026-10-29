'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronsLeft,
  FileUp,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Radio,
  X
} from 'lucide-react';
import { BrandLink, LivePill } from './Logo';
import { ShellGate } from './ShellGate';
import { Avatar } from './ui/Pills';
import { useAuth } from '@/lib/auth';
import { authHref } from '@/lib/nextPath';
import { useSocket, useSocketStatus } from '@/lib/socket';
import { useDialog } from '@/lib/useDialog';
import { cx } from '@/lib/api';

const nav = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/papers', label: 'Question papers', icon: FileUp },
  { href: '/admin/questions', label: 'Question bank', icon: Layers },
  { href: '/admin/exams', label: 'Live sessions', icon: Radio },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 }
];

export function AdminShell({
  children,
  title,
  subtitle,
  action
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, ready, logout } = useAuth();
  const socket = useSocket();
  const status = useSocketStatus(socket);
  const [open, setOpen] = useState(false);
  const closeDrawer = useCallback(() => setOpen(false), []);
  // Escape to close, focus trapped inside, focus returned to the menu button.
  const drawerRef = useDialog<HTMLDivElement>(open, closeDrawer);
  /** Set by "Log out", so that exit does not carry a return path. */
  const signingOut = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      // Expired or missing session: open the faculty tab and come back here after.
      router.replace(
        signingOut.current ? '/login?role=faculty' : authHref('/login', 'faculty', pathname === '/admin' ? null : pathname)
      );
    } else if (user.role !== 'admin') router.replace('/student');
  }, [ready, user, router, pathname]);

  useEffect(() => setOpen(false), [pathname]);

  if (!ready || !user || user.role !== 'admin') {
    return <ShellGate label="Verifying faculty access…" />;
  }

  const signOut = () => {
    signingOut.current = true;
    logout();
    router.replace('/login?role=faculty');
  };

  const SupportLink = (
    <Link
      href="/contact?topic=feedback"
      className="group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-medium text-white/60 transition duration-200 focus-ring hover:bg-white/[0.045] hover:text-white"
    >
      <MessageSquareText className="h-[18px] w-[18px] text-white/40 transition group-hover:text-white/75" />
      Help &amp; feedback
    </Link>
  );

  const NavList = (
    <nav aria-label="Console" className="flex flex-col gap-1">
      {nav.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition duration-200 focus-ring',
              active
                ? 'bg-gradient-to-r from-gold-300/[0.13] via-white/[0.035] to-transparent text-white ring-1 ring-inset ring-gold-200/[0.14]'
                : 'text-white/60 hover:bg-white/[0.045] hover:text-white'
            )}
          >
            {active && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-gold-200 to-gold-500"
              />
            )}
            <item.icon
              className={cx(
                'h-[18px] w-[18px] transition',
                active ? 'text-gold-300' : 'text-white/40 group-hover:text-white/75'
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 grid-veil opacity-50" />
        <div className="aura aura-royal -left-40 -top-24 h-[30rem] w-[30rem]" />
        <div className="aura aura-gold -bottom-24 right-0 h-[26rem] w-[26rem]" />
      </div>

      <div className="mx-auto flex max-w-[1560px]">
        {/* sidebar */}
        <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col border-r border-white/[0.07] bg-gradient-to-b from-ink-900/80 to-ink-950/60 px-4 py-6 lg:flex">
          <div className="px-1.5">
            <BrandLink href="/admin" />
          </div>

          <p className="eyebrow mb-3 mt-9 px-3.5 text-[10.5px]">Workspace</p>
          <div className="flex-1">
            {NavList}
            <p className="eyebrow mb-3 mt-8 px-3.5 text-[10.5px]">Support</p>
            {SupportLink}
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Realtime link</span>
              <LivePill label={status === 'online' ? 'online' : 'offline'} tone={status === 'online' ? 'gold' : 'glass'} />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-white/50">
              One room per exam code. Pushes reach every device in about 40 ms.
            </p>
          </div>

          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
            <span className="flex shrink-0 rounded-full bg-gradient-to-br from-gold-200/80 to-gold-600/40 p-[1.5px]">
              <Avatar name={user.name} size={36} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-white">{user.name}</p>
              <p className="truncate text-[11.5px] text-gold-200/70">Administrator</p>
            </div>
            <button
              onClick={signOut}
              className="focus-ring rounded-lg p-2 text-white/45 transition hover:bg-white/[0.06] hover:text-ember-300"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  onClick={() => setOpen(true)}
                  className="focus-ring rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-white/70 transition hover:border-white/25 hover:text-white lg:hidden"
                  aria-label="Open navigation"
                  aria-expanded={open}
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate font-display text-[21px] font-medium leading-tight text-white sm:text-[24px]">
                    {title}
                  </h1>
                  {subtitle && <p className="mt-1 truncate text-[13px] text-white/55">{subtitle}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11.5px] font-medium uppercase tracking-[0.12em] text-white/60 sm:inline-flex">
                  <span
                    className={cx(
                      'h-1.5 w-1.5 rounded-full',
                      status === 'online' ? 'bg-mint-400 shadow-[0_0_8px_rgba(83,207,162,0.8)]' : 'bg-ember-500'
                    )}
                  />
                  {status}
                </span>
                {action}
              </div>
            </div>
          </header>

          <main id="main" className="px-4 py-6 sm:px-8 sm:py-8">
            {children}
          </main>
        </div>
      </div>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div
            className="absolute inset-0 animate-fadeIn bg-ink-950/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="relative flex h-full w-[284px] animate-slideInLeft flex-col border-r border-white/10 bg-ink-900 px-4 py-5 shadow-lift"
          >
            <div className="flex items-center justify-between px-1">
              <BrandLink href="/admin" />
              <button
                onClick={() => setOpen(false)}
                className="focus-ring rounded-lg p-2 text-white/60 transition hover:bg-white/[0.06] hover:text-white"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="eyebrow mb-3 mt-8 px-3.5 text-[10.5px]">Workspace</p>
            <div>{NavList}</div>
            <p className="eyebrow mb-3 mt-7 px-3.5 text-[10.5px]">Support</p>
            <div>{SupportLink}</div>
            <div className="mt-auto flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
              <Avatar name={user.name} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-white">{user.name}</p>
                <p className="truncate text-[11.5px] text-gold-200/70">Administrator</p>
              </div>
            </div>
            <button
              onClick={signOut}
              className="focus-ring mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-[13.5px] text-white/70 transition hover:border-ember-500/40 hover:text-ember-300"
            >
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-[13px] text-white/55 transition hover:text-white"
    >
      <ChevronsLeft className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}
