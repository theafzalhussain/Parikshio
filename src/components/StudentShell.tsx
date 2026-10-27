'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LogOut } from 'lucide-react';
import { BrandLink, LivePill } from './Logo';
import { Avatar } from './ui/Pills';
import { useAuth } from '@/lib/auth';
import { useSocket, useSocketStatus } from '@/lib/socket';
import { cx } from '@/lib/api';

export function StudentShell({
  children,
  maxWidth = 'max-w-6xl',
  bare = false
}: {
  children: React.ReactNode;
  maxWidth?: string;
  bare?: boolean;
}) {
  const router = useRouter();
  const { user, ready, logout } = useAuth();
  const socket = useSocket();
  const status = useSocketStatus(socket);

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace('/login');
    else if (user.role !== 'student') router.replace('/admin');
  }, [ready, user, router]);

  if (!ready || !user || user.role !== 'student') {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-[12.5px] text-white/40">
          <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-white/30 border-t-transparent" />
          Opening your exam window…
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 grid-veil opacity-35" />
        <div className="aura aura-violet -left-32 -top-32 h-[24rem] w-[24rem]" />
        <div className="aura aura-mint -right-20 bottom-0 h-[22rem] w-[22rem]" />
      </div>

      {!bare && (
        <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
          <div className={cx('mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6', maxWidth)}>
            <BrandLink href="/student" />
            <div className="flex items-center gap-2.5">
              <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[10.5px] uppercase tracking-[0.12em] text-white/40 sm:inline-flex">
                <span className={cx('h-1.5 w-1.5 rounded-full', status === 'online' ? 'bg-mint-400' : 'bg-ember-500')} />
                {status}
              </span>
              <Link
                href="/student"
                className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 transition hover:border-white/20"
              >
                <Avatar name={user.name} size={24} />
                <span className="hidden text-[12px] text-white/70 sm:block">{user.name.split(' ')[0]}</span>
              </Link>
              <button
                onClick={() => {
                  logout();
                  router.replace('/login');
                }}
                className="rounded-xl border border-white/[0.08] p-2 text-white/35 transition hover:text-ember-400"
                aria-label="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </header>
      )}

      <main id="main" className={cx('mx-auto px-4 py-6 sm:px-6 sm:py-8', maxWidth)}>
        {children}
      </main>
    </div>
  );
}

export function StudentHeroBadge() {
  return <LivePill label="exam window" tone="lime" />;
}
