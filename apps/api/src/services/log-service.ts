import type { LogLevel, LogListResponse, LogVolumePoint, TimeRange } from '@minidog/types';
import { customWindow, timeWindow, type TimeWindow } from '../lib/time-window';
import type { LogRepository } from '../repositories/log-repository';
import type { Scope } from '../repositories/project-repository';

/** Logs of one trace are looked up across the whole retention, not the selected range. */
const TRACE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

export interface LogQuery {
  range: TimeRange;
  /** Absolute window (epoch ms) selected on a chart; overrides `range`. */
  from?: number;
  to?: number;
  service?: string;
  minLevel?: LogLevel;
  query?: string;
  traceId?: string;
  limit: number;
}

type Buckets = Pick<TimeWindow, 'startSeconds' | 'endSeconds' | 'stepSeconds' | 'fromMs'>;

export class LogService {
  constructor(
    private readonly logs: LogRepository,
    private readonly scope: Scope,
  ) {}

  async search({ range, from, to, limit, ...filters }: LogQuery): Promise<LogListResponse> {
    const now = Date.now();
    const custom = from !== undefined && to !== undefined ? customWindow(from, to) : null;
    const window: Buckets = custom ?? timeWindow(range, now);
    // A trace's logs are found wherever they are, regardless of the window.
    const bounds = filters.traceId ? { fromMs: now - TRACE_LOOKBACK_MS } : { fromMs: window.fromMs, toMs: custom?.toMs };

    const [logs, points, services] = await Promise.all([
      this.logs.search(this.scope, { ...filters, ...bounds, limit }),
      filters.traceId ? Promise.resolve([]) : this.logs.volume(this.scope, { ...filters, ...bounds }, window.stepSeconds),
      this.logs.services(this.scope, window.fromMs),
    ]);

    return {
      range,
      logs,
      truncated: logs.length >= limit,
      series: { stepSeconds: window.stepSeconds, points: filters.traceId ? [] : fillVolume(window, points) },
      services,
    };
  }
}

function fillVolume(window: Buckets, rows: readonly LogVolumePoint[]): LogVolumePoint[] {
  const byBucket = new Map(rows.map((row) => [row.t, row]));
  const points: LogVolumePoint[] = [];
  for (let t = window.startSeconds; t <= window.endSeconds; t += window.stepSeconds) {
    points.push(byBucket.get(t) ?? { t, total: 0, errors: 0 });
  }
  return points;
}
