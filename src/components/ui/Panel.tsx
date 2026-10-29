import { cx } from '@/lib/api';

export function Panel({
  className,
  children,
  hover = false
}: {
  className?: string;
  children: React.ReactNode;
  hover?: boolean;
}) {
  return (
    <div
      className={cx(
        'panel',
        hover && 'transition duration-300 hover:border-white/15 hover:bg-white/[0.045] hover:shadow-lift',
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionHead({
  eyebrow,
  title,
  sub,
  action,
  className
}: {
  eyebrow?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 className="text-xl font-semibold tracking-[-0.025em] text-white sm:text-[24px]">{title}</h2>
        {sub && <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-white/45">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'violet' | 'lime' | 'mint' | 'ember' | 'sky' | 'amber';

const tones: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-white/60 ring-white/10',
  violet: 'bg-aurora-500/12 text-aurora-100 ring-aurora-400/25',
  lime: 'bg-lime-400/12 text-lime-300 ring-lime-400/25',
  mint: 'bg-mint-500/12 text-mint-300 ring-mint-400/25',
  ember: 'bg-ember-500/12 text-ember-400 ring-ember-500/25',
  sky: 'bg-sky-400/10 text-sky-300 ring-sky-400/25',
  amber: 'bg-amber-400/12 text-amber-300 ring-amber-400/25'
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  dot
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] ring-1 ring-inset',
        tones[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = 'violet',
  className
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.045] to-white/[0.015] p-4',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">{label}</p>
        {icon && (
          <span className={cx('grid h-7 w-7 place-items-center rounded-lg ring-1 ring-inset', tones[tone])}>
            {icon}
          </span>
        )}
      </div>
      <p className="num mt-2 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-[11.5px] text-white/35">{hint}</p>}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent', className)} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-14 text-center">
      {icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.05] text-white/40">{icon}</div>}
      <p className="text-sm font-medium text-white/85">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-white/40">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
