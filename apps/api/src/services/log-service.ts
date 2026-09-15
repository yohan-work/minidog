import { RETENTION_MAX_DAYS, type LogLevel, type LogListResponse, type LogTailResponse, type LogVolumePoint, type TimeRange } from '@minidog/types';
import { customWindow, timeWindow, type TimeWindow } from '../lib/time-window';
import type { LogRepository } from '../repositories/log-repository';
import type { Scope } from '../repositories/project-repository';

/** Logs of one trace are looked up across the whole retention, not the selected range. */
const TRACE_LOOKBACK_MS = RETENTION_MAX_DAYS * 24 * 60 * 60 * 1000;
/** Live tail catches up at most this far back, e.g. after a long pause. */
const TAIL_MAX_LOOKBACK_MS = 15 * 60 * 1000;

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

export interface LogTailQuery {
  /** Epoch ms. */
  since: number;
  service?: string;
  minLevel?: LogLevel;
  query?: string;
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

  /** Records from `since` on, for live tail; no volume or service list, so it is cheap to poll. */
  async tail({ since, limit, ...filters }: LogTailQuery): Promise<LogTailResponse> {
    const now = Date.now();
    const fromMs = Math.max(since, now - TAIL_MAX_LOOKBACK_MS);
    const logs = await this.logs.search(this.scope, { ...filters, fromMs, limit });
    return { logs, truncated: logs.length >= limit, since: fromMs, now };
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
