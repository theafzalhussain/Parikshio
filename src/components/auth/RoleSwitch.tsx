'use client';

import { useRef } from 'react';
import { GraduationCap, Presentation } from 'lucide-react';
import { cx } from '@/lib/api';
import type { AuthRole } from '@/lib/nextPath';

const OPTIONS: { key: AuthRole; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'student', label: 'Student', icon: GraduationCap },
  { key: 'faculty', label: 'Faculty & admin', icon: Presentation }
];

/** Id of the tab for `role`, for the panel's aria-labelledby. */
export function roleTabId(idBase: string, role: AuthRole) {
  return `${idBase}-tab-${role}`;
}

export function rolePanelId(idBase: string) {
  return `${idBase}-panel`;
}

/**
 * Keeps `?role=` in the address bar in step with the selected tab, so a
 * refresh or a shared link opens the same tab. No navigation happens.
 */
export function syncRoleToUrl(role: AuthRole) {
  const url = new URL(window.location.href);
  if (role === 'faculty') url.searchParams.set('role', 'faculty');
  else url.searchParams.delete('role');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * "Student | Faculty & admin" switch at the top of the sign-in and sign-up
 * forms. It follows the ARIA tabs pattern: one Tab stop, arrow keys, Home and
 * End move between the two options and select them.
 */
export function RoleSwitch({
  value,
  onChange,
  idBase,
  label,
  className
}: {
  value: AuthRole;
  onChange: (role: AuthRole) => void;
  idBase: string;
  /** Accessible name of the tab list, e.g. "Sign in as". */
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = OPTIONS.length - 1;
    let target = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = index === 0 ? last : index - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = last;
    if (target < 0) return;
    event.preventDefault();
    onChange(OPTIONS[target]!.key);
    refs.current[target]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx(
        'relative grid grid-cols-2 rounded-2xl border border-white/[0.08] bg-ink-950/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        className
      )}
    >
      {/* Sliding indicator under the selected option. */}
      <span
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xl bg-gradient-to-b from-white/[0.1] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_22px_-12px_rgba(0,0,0,0.9)] ring-1 ring-inset ring-gold-300/30 transition-transform duration-300 ease-out motion-reduce:transition-none',
          value === 'faculty' && 'translate-x-full'
        )}
      />
      {OPTIONS.map((option, index) => {
        const selected = option.key === value;
        return (
          <button
            key={option.key}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={roleTabId(idBase, option.key)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={rolePanelId(idBase)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              'focus-ring relative z-10 inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-[13.5px] font-medium transition-colors duration-200',
              selected ? 'text-white' : 'text-white/55 hover:text-white/85'
            )}
          >
            <option.icon className={cx('h-4 w-4 shrink-0 transition-colors', selected ? 'text-gold-300' : 'text-white/40')} />
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
