/** 0:45 / 12:03 — a countdown readout. Never negative. */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 45s / 4m / 7m 30s / 1h 5m — a human allowance. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

export const TIMER_PRESETS = [20, 30, 45, 60, 90, 120, 180, 300];
export const MIN_TIMER = 5;
export const MAX_TIMER = 3600;

export function clampTimer(value: number): number {
  if (!Number.isFinite(value)) return 60;
  return Math.max(MIN_TIMER, Math.min(MAX_TIMER, Math.trunc(value)));
}
