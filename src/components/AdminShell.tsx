'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  ChevronsLeft,
  FileUp,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  X
} from 'lucide-react';
import { BrandLink, LivePill } from './Logo';
import { Avatar } from './ui/Pills';
import { useAuth } from '@/lib/auth';
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

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace('/login');
    else if (user.role !== 'admin') router.replace('/student');
  }, [ready, user, router]);

  useEffect(() => setOpen(false), [pathname]);

  if (!ready || !user || user.role !== 'admin') {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-[12.5px] text-white/40">
          <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-white/30 border-t-transparent" />
          Verifying faculty access…
        </div>
      </div>
    );
  }

  const NavList = (
    <nav className="flex flex-col gap-1">
      {nav.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cx(
              'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition',
              active
                ? 'bg-gradient-to-r from-aurora-500/[0.22] to-transparent text-white ring-1 ring-inset ring-aurora-300/30 shadow-[0_10px_30px_-18px_rgba(228,201,143,0.8)]'
                : 'text-white/45 hover:bg-white/[0.05] hover:text-white/90'
            )}
          >
            <item.icon className={cx('h-4 w-4', active ? 'text-aurora-300' : 'text-white/30 group-hover:text-white/60')} />
            {item.label}
            {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-lime-400" />}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 grid-veil opacity-40" />
        <div className="aura aura-violet -left-40 top-0 h-[26rem] w-[26rem]" />
        <div className="aura aura-mint bottom-0 right-0 h-[24rem] w-[24rem]" />
      </div>

      <div className="mx-auto flex max-w-[1500px]">
        {/* sidebar */}
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-aurora-300/[0.12] bg-ink-950/65 px-4 py-5 backdrop-blur-xl lg:flex">
          <BrandLink href="/admin" />

          <div className="mt-7 flex-1">{NavList}</div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">realtime</span>
              <LivePill label={status === 'online' ? 'online' : 'offline'} tone={status === 'online' ? 'lime' : 'glass'} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              Socket.io room per exam code. Push latency ≈ 40 ms.
            </p>
          </div>

          <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
            <Avatar name={user.name} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-white">{user.name}</p>
              <p className="truncate text-[10.5px] uppercase tracking-[0.1em] text-white/35">admin</p>
            </div>
            <button
              onClick={() => {
                logout();
                router.replace('/login');
              }}
              className="rounded-lg p-1.5 text-white/30 transition hover:bg-white/[0.06] hover:text-ember-400"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  onClick={() => setOpen(true)}
                  className="focus-ring rounded-xl border border-white/10 p-2 text-white/60 transition hover:border-white/25 hover:text-white lg:hidden"
                  aria-label="Open navigation"
                  aria-expanded={open}
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-white">{title}</h1>
                  {subtitle && <p className="mt-0.5 truncate text-[11.5px] text-white/40">{subtitle}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[10.5px] uppercase tracking-[0.12em] text-white/40 sm:inline-flex">
                  <span
                    className={cx(
                      'h-1.5 w-1.5 rounded-full',
                      status === 'online' ? 'bg-mint-400' : 'bg-ember-500'
                    )}
                  />
                  {status}
                </span>
                {action}
              </div>
            </div>
          </header>

          <main id="main" className="px-4 py-6 sm:px-6 sm:py-8">
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
            className="relative h-full w-[264px] animate-slideIn border-r border-white/10 bg-ink-900 px-4 py-5"
          >
            <div className="flex items-center justify-between">
              <BrandLink href="/admin" />
              <button
                onClick={() => setOpen(false)}
                className="focus-ring rounded-lg p-1.5 text-white/50 transition hover:bg-white/[0.06] hover:text-white"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-7">{NavList}</div>
            <button
              onClick={() => {
                logout();
                router.replace('/login');
              }}
              className="focus-ring mt-6 flex w-full items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-[12.5px] text-white/60 transition hover:border-white/25 hover:text-white"
            >
              <LogOut className="h-4 w-4" /> Sign out
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
      className="inline-flex items-center gap-1.5 rounded-lg text-[12px] text-white/40 transition hover:text-white"
    >
      <ChevronsLeft className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}
