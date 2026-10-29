'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react';
import { cx } from '@/lib/api';

type Kind = 'info' | 'success' | 'error' | 'warn';
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
}

const ToastContext = createContext<{
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
} | null>(null);

const palette: Record<Kind, { ring: string; icon: string; bar: string; glyph: typeof Info }> = {
  info: { ring: 'ring-royal-400/25', icon: 'text-royal-100 bg-royal-500/[0.16] ring-royal-400/30', bar: 'bg-royal-400/80', glyph: Info },
  success: { ring: 'ring-mint-400/25', icon: 'text-mint-300 bg-mint-500/[0.15] ring-mint-400/30', bar: 'bg-mint-400/80', glyph: Check },
  error: { ring: 'ring-ember-500/30', icon: 'text-ember-300 bg-ember-500/[0.15] ring-ember-500/35', bar: 'bg-ember-500/80', glyph: XCircle },
  warn: { ring: 'ring-amber-400/25', icon: 'text-amber-200 bg-amber-400/[0.15] ring-amber-400/30', bar: 'bg-amber-400/80', glyph: AlertTriangle }
};

/** Errors need reading time; a success confirmation does not. */
const LIFETIME: Record<Kind, number> = { info: 4500, success: 4500, warn: 6000, error: 8000 };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const arm = useCallback(
    (id: number, ms: number) => {
      const timer = window.setTimeout(() => dismiss(id), ms);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
      arm(id, LIFETIME[t.kind]);
    },
    [arm]
  );

  // Clear every pending timer if the provider unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  /** Hovering or focusing a toast should not race the reader to dismiss it. */
  const hold = (id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  };
  const release = (id: number, kind: Kind) => {
    if (!timers.current.has(id)) arm(id, LIFETIME[kind]);
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(92vw,380px)] flex-col gap-2.5">
        {toasts.map((t) => {
          const tone = palette[t.kind];
          const Glyph = tone.glyph;
          return (
            <div
              key={t.id}
              // Each toast is its own live region: `alert` is announced at once,
              // `status` waits for a pause in speech.
              role={t.kind === 'error' || t.kind === 'warn' ? 'alert' : 'status'}
              data-toast={t.kind}
              onMouseEnter={() => hold(t.id)}
              onMouseLeave={() => release(t.id, t.kind)}
              onFocusCapture={() => hold(t.id)}
              onBlurCapture={() => release(t.id, t.kind)}
              className={cx(
                'group pointer-events-auto relative animate-slideIn overflow-hidden rounded-2xl border border-white/10 bg-ink-850/95 p-4 pr-11 shadow-lift ring-1 backdrop-blur-xl',
                tone.ring
              )}
            >
              <div className="flex gap-3">
                <span
                  className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset', tone.icon)}
                  aria-hidden="true"
                >
                  <Glyph className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold leading-snug text-white">{t.title}</p>
                  {t.body && <p className="mt-1 text-[13px] leading-relaxed text-white/65">{t.body}</p>}
                </div>
              </div>

              <button
                onClick={() => dismiss(t.id)}
                className="focus-ring absolute right-2.5 top-2.5 rounded-lg p-1.5 text-white/45 transition hover:bg-white/[0.08] hover:text-white"
                aria-label={`Dismiss: ${t.title}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>

              {/* Time-remaining hint. Pauses with the timer on hover/focus. */}
              <span
                className={cx(
                  'absolute bottom-0 left-0 h-[2px] w-full origin-left animate-toastBar group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]',
                  tone.bar
                )}
                style={{ animationDuration: `${LIFETIME[t.kind]}ms` }}
                aria-hidden="true"
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
