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
        hover &&
          'transition duration-300 ease-out hover:-translate-y-0.5 hover:border-gold-200/20 hover:bg-ink-880/80 hover:shadow-lift',
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
        <h2 className="font-display text-[22px] font-medium leading-tight text-white sm:text-[24px]">{title}</h2>
        {sub && <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/60">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'royal' | 'gold' | 'mint' | 'ember' | 'sky' | 'amber';

const tones: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-white/70 ring-white/10',
  royal: 'bg-royal-500/[0.14] text-royal-100 ring-royal-400/30',
  gold: 'bg-gold-400/[0.12] text-gold-200 ring-gold-300/30',
  mint: 'bg-mint-500/[0.13] text-mint-300 ring-mint-400/30',
  ember: 'bg-ember-500/[0.13] text-ember-300 ring-ember-500/30',
  sky: 'bg-sky-400/[0.11] text-sky-200 ring-sky-400/30',
  amber: 'bg-amber-400/[0.12] text-amber-200 ring-amber-400/30'
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
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] ring-1 ring-inset',
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
  tone = 'royal',
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
        'group relative overflow-hidden rounded-2xl border border-white/[0.075] bg-ink-900/70 p-4 shadow-card transition duration-300 hover:border-white/[0.14] sm:p-5',
        className
      )}
      style={{ backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.01) 70%)' }}
    >
      {/* Champagne hairline across the top edge. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-gold-200/30 to-transparent"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/55">{label}</p>
        {icon && (
          // Hidden on the narrowest phones so a one-word label like "Accuracy" keeps its room.
          <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1 ring-inset max-[359px]:hidden', tones[tone])}>
            {icon}
          </span>
        )}
      </div>
      <p className="num mt-2.5 text-[28px] font-semibold leading-none text-white">{value}</p>
      {hint && <p className="mt-2 text-[12.5px] leading-snug text-white/50">{hint}</p>}
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.015] px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gold-400/[0.08] text-gold-200 ring-1 ring-inset ring-gold-300/20">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-medium text-white/90">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-white/55">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
