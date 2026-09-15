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

/** Bucket sizes for a window chosen on a chart, smallest first. */
const CUSTOM_STEPS_SECONDS = [10, 30, 60, 300, 900, 3600, 7200] as const;
const MAX_CUSTOM_BUCKETS = 120;

export interface CustomWindow {
  stepSeconds: number;
  startSeconds: number;
  endSeconds: number;
  fromMs: number;
  toMs: number;
}

/** An absolute window (`?from=&to=`), bucketed so it holds at most 120 buckets. */
export function customWindow(fromMs: number, toMs: number): CustomWindow {
  const seconds = Math.max(1, (toMs - fromMs) / 1000);
  const stepSeconds = CUSTOM_STEPS_SECONDS.find((step) => seconds / step <= MAX_CUSTOM_BUCKETS) ?? 7200;
  return {
    stepSeconds,
    startSeconds: Math.floor(fromMs / 1000 / stepSeconds) * stepSeconds,
    endSeconds: Math.floor((toMs - 1) / 1000 / stepSeconds) * stepSeconds,
    fromMs,
    toMs,
  };
}

/** Query bounds: an absolute window when given, otherwise the preset range up to now. */
export function queryBounds(range: TimeRange, from?: number, to?: number): { fromMs: number; toMs?: number } {
  return from !== undefined && to !== undefined ? { fromMs: from, toMs: to } : { fromMs: timeWindow(range).fromMs };
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
