'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/types';
import { getToken } from './api';

export type AxiomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * One socket per browser tab (singleton) — reconnects automatically.
 */
let singleton: AxiomSocket | null = null;
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

export function getSocket(): AxiomSocket {
  const token = getToken() ?? '';
  if (singleton && (singleton.auth as { token?: string })?.token === token) return singleton;
  singleton?.disconnect();
  singleton = io(API_ORIGIN || undefined, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionAttempts: Infinity
  }) as AxiomSocket;
  return singleton;
}

export function useSocket(): AxiomSocket {
  const socket = useMemo(() => getSocket(), []);
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    socket.on('connect', bump);
    socket.on('disconnect', bump);
    return () => {
      socket.off('connect', bump);
      socket.off('disconnect', bump);
    };
  }, [socket]);
  return socket;
}

export function useSocketStatus(socket: AxiomSocket): 'online' | 'offline' {
  const [status, setStatus] = useState<'online' | 'offline'>(socket.connected ? 'online' : 'offline');
  useEffect(() => {
    const on = () => setStatus('online');
    const off = () => setStatus('offline');
    socket.on('connect', on);
    socket.on('disconnect', off);
    return () => {
      socket.off('connect', on);
      socket.off('disconnect', off);
    };
  }, [socket]);
  return status;
}

/**
 * Server-synchronised clock. Every `time:sync` broadcast recomputes the offset
 * between this device and the server, so countdowns never drift.
 */
export function useServerClock(socket: AxiomSocket) {
  const offsetRef = useRef(0);
  const [, tick] = useState(0);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const onSync = ({ serverTime }: { serverTime: number }) => {
      offsetRef.current = serverTime - Date.now();
      setSynced(true);
    };
    socket.on('time:sync', onSync);
    if (socket.connected) socket.emit('time:sync:request');
    socket.on('connect', () => socket.emit('time:sync:request'));
    return () => {
      socket.off('time:sync', onSync);
    };
  }, [socket]);

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  return { now: Date.now() + offsetRef.current, synced };
}

export function useCountdown(endsAt: number | null | undefined, now: number) {
  if (!endsAt) return { remaining: 0, total: 0, pct: 0, expired: true };
  const remaining = Math.max(0, endsAt - now);
  return { remaining, total: remaining, pct: 0, expired: remaining <= 0 };
}

export function useAnimatedNumber(value: number, duration = 550) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = to;
    };
  }, [value, duration]);

  return display;
}
