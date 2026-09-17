import { RETENTION_MAX_DAYS, TIME_RANGES, type SeriesPoint, type TimeRange } from '@minidog/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Spans and logs of one trace are looked up this far either side of the hint. */
export const TRACE_HINT_MARGIN_MS = DAY_MS;

/** Without a hint, a trace is looked up across everything that can still be kept. */
const TRACE_LOOKBACK_MS = RETENTION_MAX_DAYS * DAY_MS;

/**
 * Bounds for looking up one trace. A trace id says nothing about time, so on
 * its own the lookup covers the whole retention: every daily partition, even
 * with the bloom filter on trace_id. Every screen that links to a trace knows
 * when it happened; with that hint (`at`, epoch ms) the lookup touches the
 * days around it. A day either side covers traces that cross midnight and
 * consumers that pick up a message long after the producer.
 */
export function traceBounds(at: number | undefined, nowMs: number = Date.now()): { fromMs: number; toMs?: number } {
  if (at === undefined) return { fromMs: nowMs - TRACE_LOOKBACK_MS };
  return { fromMs: at - TRACE_HINT_MARGIN_MS, toMs: at + TRACE_HINT_MARGIN_MS };
}

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
