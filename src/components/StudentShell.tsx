'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { CloudUpload, LogOut, MessageSquareText, RefreshCw } from 'lucide-react';
import { BrandLink, LivePill } from './Logo';
import { ShellGate } from './ShellGate';
import { Avatar } from './ui/Pills';
import { useAuth } from '@/lib/auth';
import { authHref } from '@/lib/nextPath';
import { useSocket, useSocketStatus } from '@/lib/socket';
import { useOutbox } from '@/lib/useOutbox';
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
  const outbox = useOutbox(user?.id ?? null);
  // The browser's own verdict outranks the socket: a dropped WebSocket on a
  // working network is a server blip, not an offline device.
  const connected = outbox.online && status === 'online';
  /** Set by "Log out", so that exit does not carry a return path. */
  const signingOut = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      // Expired or missing session: log in, then come back to this exact page
      // (including an exam link such as /student?join=CODE).
      const here = `${window.location.pathname}${window.location.search}`;
      router.replace(signingOut.current ? '/login' : authHref('/login', 'student', here === '/student' ? null : here));
    } else if (user.role !== 'student') router.replace('/admin');
  }, [ready, user, router]);

  if (!ready || !user || user.role !== 'student') {
    return <ShellGate label="Opening your exam window…" />;
  }

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 grid-veil opacity-45" />
        <div className="aura aura-royal -left-32 -top-32 h-[28rem] w-[28rem]" />
        <div className="aura aura-gold -right-24 bottom-0 h-[24rem] w-[24rem]" />
      </div>

      {!bare && (
        <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
          <div className={cx('mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 min-[360px]:gap-3 sm:px-6', maxWidth)}>
            <BrandLink href="/student" />
            <div className="flex items-center gap-1.5 min-[360px]:gap-2">
              {outbox.pending.length > 0 && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11.5px] font-medium uppercase tracking-[0.1em] text-amber-200"
                  title="Answers saved on this device, waiting to be delivered"
                >
                  {outbox.syncing ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <CloudUpload className="h-3 w-3" />
                  )}
                  {outbox.pending.length} queued
                </span>
              )}
              <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11.5px] font-medium uppercase tracking-[0.12em] text-white/60 sm:inline-flex">
                <span
                  className={cx(
                    'h-1.5 w-1.5 rounded-full',
                    connected ? 'bg-mint-400 shadow-[0_0_8px_rgba(83,207,162,0.8)]' : 'bg-ember-500'
                  )}
                />
                {connected ? 'online' : 'offline'}
              </span>
              <Link
                href="/student"
                className="focus-ring flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-1 pr-1 transition hover:border-gold-200/30 sm:pr-3.5"
              >
                <Avatar name={user.name} size={28} />
                <span className="hidden text-[13px] font-medium text-white/85 sm:block">{user.name.split(' ')[0]}</span>
              </Link>
              <Link
                href="/contact?topic=feedback"
                className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-white/[0.08] text-white/50 transition hover:border-gold-200/30 hover:text-gold-200"
                aria-label="Help & feedback"
                title="Help & feedback"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
              </Link>
              <button
                onClick={() => {
                  signingOut.current = true;
                  logout();
                  router.replace('/login');
                }}
                className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-white/[0.08] text-white/50 transition hover:border-ember-500/40 hover:text-ember-300"
                aria-label="Log out"
                title="Log out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </header>
      )}

      <main id="main" className={cx('mx-auto px-4 py-6 sm:px-6 sm:py-10', maxWidth)}>
        {children}
      </main>
    </div>
  );
}

export function StudentHeroBadge() {
  return <LivePill label="exam window" tone="gold" />;
}
