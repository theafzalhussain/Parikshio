'use client';

import { cx } from '@/lib/api';

export function Label({
  children,
  hint,
  htmlFor
}: {
  children: React.ReactNode;
  hint?: string;
  /**
   * Ties the label to its control's `id`. Without it a click on the label does
   * not focus the field and screen readers announce the input unnamed, so pass
   * it whenever the control has an id.
   */
  htmlFor?: string;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label
        htmlFor={htmlFor}
        className="text-[11.5px] font-medium uppercase tracking-[0.12em] text-white/45"
      >
        {children}
      </label>
      {hint && <span className="text-[11px] text-white/25">{hint}</span>}
    </div>
  );
}

/**
 * Caption for a *set* of controls — a list of toggle buttons, a radio group —
 * rather than a single field. A `<label>` may only name one control, so using
 * `Label` here would leave the group unnamed to a screen reader. Pair the `id`
 * with `role="group"` + `aria-labelledby` on the container.
 */
export function GroupLabel({
  children,
  hint,
  id
}: {
  children: React.ReactNode;
  hint?: string;
  id: string;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <p id={id} className="text-[11.5px] font-medium uppercase tracking-[0.12em] text-white/45">
        {children}
      </p>
      {hint && <span className="text-[11px] text-white/25">{hint}</span>}
    </div>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input-base', className)} {...props} />;
}

export function TextArea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('input-base resize-y leading-relaxed', className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx('input-base appearance-none bg-ink-900 pr-9', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='1.6'><path d='M3 6l5 5 5-5'/></svg>\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center'
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 text-[12.5px] text-white/60 focus-ring"
      aria-pressed={checked}
    >
      <span
        className={cx(
          'relative h-5 w-9 rounded-full transition',
          checked ? 'bg-aurora-500' : 'bg-white/15'
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5'
          )}
        />
      </span>
      {label}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-ink-900/60 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cx(
            'rounded-lg px-3 py-1.5 text-[12px] font-medium transition',
            value === opt.value
              ? 'bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
              : 'text-white/45 hover:text-white/75'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
