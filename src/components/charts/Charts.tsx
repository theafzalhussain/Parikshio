import { cx } from '@/lib/api';

export function Sparkline({
  points,
  className,
  stroke = '#CBFF3D',
  fill = 'rgba(203,255,61,0.18)',
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
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cx('w-full', className)} style={{ height }}>
      <path d={area} fill={fill} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BarChart({
  data,
  className,
  height = 170,
  accent = '#9E82FF'
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
              <span className="num text-[11px] font-medium text-white/55 opacity-0 transition group-hover:opacity-100">
                {d.hint ?? d.value}
              </span>
              <div
                className="w-full rounded-t-lg transition-all duration-500 group-hover:brightness-125"
                style={{
                  height: h,
                  background: `linear-gradient(180deg, ${accent} 0%, ${accent}22 100%)`,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25)`
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex gap-2.5">
        {data.map((d, i) => (
          <div key={`${d.label}-label-${i}`} className="flex-1 truncate text-center text-[10.5px] text-white/35">
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
  accent = '#CBFF3D'
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
        <span className="truncate text-[12.5px] text-white/60">{label}</span>
        <span className="num text-[12px] font-medium text-white/80">
          {value}
          {suffix}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
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
  accent = '#CBFF3D'
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
      <svg width={size} height={size} className="-rotate-90">
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
        {sub && <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/35">{sub}</p>}
      </div>
    </div>
  );
}

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
  const accent = urgent ? '#FF6B3D' : fraction > 0.4 ? '#CBFF3D' : '#FFB020';
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="timer-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
            <stop offset="100%" stopColor={urgent ? '#FF8A5B' : '#4FEBAB'} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#timer-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          style={{ transition: 'stroke-dashoffset 320ms linear' }}
        />
      </svg>
      <div className="absolute text-center">
        <p className={cx('num text-[30px] font-semibold leading-none', urgent ? 'text-ember-400' : 'text-white')}>
          {mm}:{ss.toString().padStart(2, '0')}
        </p>
        <p className="mt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-white/35">
          {urgent ? 'hurry' : 'remaining'}
        </p>
      </div>
    </div>
  );
}
