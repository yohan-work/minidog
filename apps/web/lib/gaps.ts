import type { MeasurementGap } from '@minidog/types';

/** Milliseconds of [fromMs, toMs) covered by gaps. */
export function gapOverlapMs(gaps: readonly MeasurementGap[], fromMs: number, toMs: number): number {
  let total = 0;
  for (const gap of gaps) total += Math.max(0, Math.min(gap.to, toMs) - Math.max(gap.from, fromMs));
  return total;
}

export function totalGapMs(gaps: readonly MeasurementGap[]): number {
  return gaps.reduce((sum, gap) => sum + Math.max(0, gap.to - gap.from), 0);
}

/** `45 s`, `12 min`, `2 h 10 min`, `3 d 4 h` */
export function formatGapDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export const GAP_REASONS: Record<MeasurementGap['reason'], string> = {
  stopped: 'minidog was not running',
  asleep: 'this computer was asleep',
};
