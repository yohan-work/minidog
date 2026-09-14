import { TIME_RANGES, type SeriesPoint, type TimeRange } from '@minidog/types';

export interface TimeWindow {
  range: TimeRange;
  stepSeconds: number;
  /** First bucket start, epoch seconds. */
  startSeconds: number;
  /** Last bucket start, epoch seconds. */
  endSeconds: number;
  /** Lower bound for queries, epoch milliseconds. */
  fromMs: number;
}

/**
 * Aligns a range to bucket boundaries so that every aggregate in one response
 * (summary, totals, series) covers exactly the same time span.
 */
export function timeWindow(range: TimeRange, nowMs: number = Date.now()): TimeWindow {
  const { seconds, stepSeconds } = TIME_RANGES[range];
  const buckets = Math.ceil(seconds / stepSeconds);
  const endSeconds = Math.floor(nowMs / 1000 / stepSeconds) * stepSeconds;
  const startSeconds = endSeconds - (buckets - 1) * stepSeconds;
  return { range, stepSeconds, startSeconds, endSeconds, fromMs: startSeconds * 1000 };
}

/** Returns one point per bucket; buckets without checks carry null latency. */
export function fillSeries(window: TimeWindow, rows: readonly SeriesPoint[]): SeriesPoint[] {
  const byBucket = new Map(rows.map((row) => [row.t, row]));
  const points: SeriesPoint[] = [];
  for (let t = window.startSeconds; t <= window.endSeconds; t += window.stepSeconds) {
    points.push(byBucket.get(t) ?? { t, checks: 0, failures: 0, avgLatencyMs: null, p95LatencyMs: null });
  }
  return points;
}
