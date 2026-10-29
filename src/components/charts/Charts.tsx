import { cx } from '@/lib/api';

/**
 * Chart colours, mirroring the Tailwind tokens. SVG strokes and inline
 * gradients cannot use class names, so pages import these instead of
 * hardcoding hex values.
 */
export const chartColors = {
  gold: '#DFB873',
  goldSoft: 'rgba(223,184,115,0.16)',
  royal: '#8197FF',
  mint: '#53CFA2',
  mintSoft: 'rgba(83,207,162,0.16)',
  amber: '#F5B544',
  ember: '#F06656'
} as const;

/** Traffic-light colour for an accuracy percentage. */
export function accuracyColor(pct: number): string {
  return pct >= 70 ? chartColors.mint : pct >= 40 ? chartColors.amber : chartColors.ember;
}

export function Sparkline({
  points,
  className,
  stroke = chartColors.gold,
  fill = chartColors.goldSoft,
  height = 44
}: {
  points: number[];
  className?: string;
  stroke?: string;
  fill?: string;
  height?: number;
}) {
  if (points.length < 2) return <div className={cx('h-11', className)} />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const w = 100;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = height - ((p - min) / span) * (height - 6) - 3;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${coords.join(' L')}`;
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cx('w-full', className)}
      style={{ height }}
      aria-hidden="true"
    >
      <path d={area} fill={fill} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function BarChart({
  data,
  className,
  height = 170,
  accent = chartColors.royal
}: {
  data: { label: string; value: number; hint?: string }[];
  className?: string;
  height?: number;
  accent?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={cx('w-full', className)}>
      <div className="flex items-end gap-2.5" style={{ height }}>
        {data.map((d, i) => {
          const h = Math.max(4, (d.value / max) * (height - 26));
          return (
            <div key={`${d.label}-${i}`} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
              <span className="num text-[12px] font-medium text-white/70 opacity-0 transition group-hover:opacity-100">
                {d.hint ?? d.value}
              </span>
              <div
                className="w-full rounded-t-lg transition-all duration-500 group-hover:brightness-125"
                style={{
                  height: h,
                  background: `linear-gradient(180deg, ${accent} 0%, ${accent}26 100%)`,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)'
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex gap-2.5">
        {data.map((d, i) => (
          <div key={`${d.label}-label-${i}`} className="flex-1 truncate text-center text-[11.5px] text-white/55">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HBar({
  label,
  value,
  max,
  suffix = '',
  accent = chartColors.gold
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  accent?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="truncate text-[13.5px] text-white/75">{label}</span>
        <span className="num text-[13px] font-medium text-white/90">
          {value}
          {suffix}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${accent}55, ${accent})` }}
        />
      </div>
    </div>
  );
}

export function Donut({
  value,
  label,
  sub,
  size = 132,
  stroke = 10,
  accent = chartColors.gold
}: {
  value: number;
  label?: string;
  sub?: string;
  size?: number;
  stroke?: number;
  accent?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (clamped / 100) * c}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="num text-[22px] font-semibold leading-none text-white">{label ?? `${Math.round(clamped)}%`}</p>
        {sub && <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-white/55">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * Countdown ring. Colour follows the familiar traffic-light order — emerald
 * while there is time, amber past 60%, coral in the final seconds — so the
 * state reads at a glance without the numbers.
 */
export function RadialTimer({
  remaining,
  total,
  size = 168,
  stroke = 9,
  urgent = false
}: {
  remaining: number;
  total: number;
  size?: number;
  stroke?: number;
  urgent?: boolean;
}) {
  const safeTotal = Math.max(total, 1);
  const fraction = Math.max(0, Math.min(1, remaining / safeTotal));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const seconds = Math.ceil(remaining / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  const accent = urgent ? chartColors.ember : fraction > 0.4 ? chartColors.mint : chartColors.amber;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* Soft inner disc gives the ring a dial-like depth. */}
      <span
        aria-hidden="true"
        className="absolute rounded-full bg-gradient-to-b from-white/[0.05] to-transparent ring-1 ring-inset ring-white/[0.06]"
        style={{ inset: stroke + 6 }}
      />
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          style={{ transition: 'stroke-dashoffset 320ms linear, stroke 400ms ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <p className={cx('num text-[30px] font-semibold leading-none', urgent ? 'text-ember-300' : 'text-white')}>
          {mm}:{ss.toString().padStart(2, '0')}
        </p>
        <p className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/50">
          {urgent ? 'hurry' : 'remaining'}
        </p>
      </div>
    </div>
  );
}
