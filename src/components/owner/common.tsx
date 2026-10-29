'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ApiError, cx } from '@/lib/api';
import { ownerApi } from '@/lib/owner';

export type SectionKey = 'overview' | 'requests' | 'users' | 'messages' | 'sessions' | 'activity' | 'settings';

/** Lets one section open another, e.g. a recent message on the overview. */
export type Navigate = (section: SectionKey, focus?: { userId?: string; messageId?: string }) => void;

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

/**
 * Loads an owner API path and reloads it on demand. Out-of-order replies are
 * dropped, so typing in a search box never shows an older result last.
 */
export function useOwnerData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const result = await ownerApi<T>(path);
      if (mine !== seq.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(errorText(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Debounced copy of a value: search boxes ask the server once typing pauses. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

export const fmtDate = (ts: number | null | undefined) => (ts ? dateFmt.format(new Date(ts)) : '—');
export const fmtDateTime = (ts: number | null | undefined) => (ts ? dateTimeFmt.format(new Date(ts)) : '—');

export function ago(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)} d ago`;
  return fmtDate(ts);
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  label
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-11 pl-10 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="focus-ring absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-white/45 hover:text-white"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** A row of filter buttons with counts; scrolls sideways on narrow phones. */
export function FilterTabs<T extends string>({
  value,
  onChange,
  options,
  label
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cx(
              'focus-ring inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-medium transition',
              active
                ? 'border-gold-300/40 bg-gold-400/[0.12] text-gold-100'
                : 'border-white/[0.08] bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white'
            )}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span
                className={cx(
                  'num rounded-md px-1.5 py-0.5 text-[11px]',
                  active ? 'bg-gold-300/20 text-gold-100' : 'bg-white/[0.07] text-white/55'
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pages" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[13px] text-white/55">
      <span>
        {from}–{to} of <span className="num text-white/80">{total}</span>
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="num min-w-[4.5rem] text-center">
          {page} / {pages}
        </span>
        <Button variant="secondary" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-ember-500/30 bg-ember-500/[0.08] px-4 py-3 text-[13.5px] text-ember-200"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyList({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.1] px-6 py-12 text-center">
      <p className="font-display text-[18px] text-white/85">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-white/50">{body}</p>}
    </div>
  );
}

/** A label/value pair in detail panels. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</dt>
      <dd className="mt-1 break-words text-[13.5px] text-white/85">{children}</dd>
    </div>
  );
}

/**
 * Confirmation for anything that changes or removes data. With `typeToConfirm`
 * the button stays disabled until that exact text is typed.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  typeToConfirm,
  busy,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const ready = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'gold'} onClick={onConfirm} disabled={!ready} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[14px] leading-relaxed text-white/70">{body}</div>
      {typeToConfirm && (
        <div className="mt-5">
          <label htmlFor="confirm-type" className="text-[13px] text-white/70">
            Type <span className="font-mono text-white">{typeToConfirm}</span> to confirm
          </label>
          <Input
            id="confirm-type"
            className="mt-2"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}
    </Modal>
  );
}

/** "Faculty" in the UI for the internal `admin` role. */
export const roleLabel = (role: 'admin' | 'student') => (role === 'admin' ? 'Faculty' : 'Student');

/** A mailto: link whose address cannot carry extra headers. */
export function mailto(email: string, subject?: string): string {
  const at = email.lastIndexOf('@');
  const address = at > 0 ? `${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}` : '';
  return `mailto:${address}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
}
