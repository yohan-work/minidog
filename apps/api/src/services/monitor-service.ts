import type {
  ApiErrorBody,
  MonitorListResponse,
  MonitorResponse,
  MonitorSummary,
  MonitorWithSummary,
  OverviewResponse,
  SyntheticMonitor,
  TimeRange,
} from '@minidog/types';
import { ClickHouseUnavailableError, NotFoundError } from '../lib/errors';
import { fillSeries, timeWindow, type TimeWindow } from '../lib/time-window';
import type { MonitorRepository } from '../repositories/monitor-repository';
import type { Scope } from '../repositories/project-repository';
import type { RawMonitorSummary, SyntheticResultRepository, Totals } from '../repositories/synthetic-result-repository';
import { deriveHealth } from './health';

/**
 * Joins monitor metadata (SQLite) with check results (ClickHouse). When
 * ClickHouse is unreachable, monitors are still returned with `unknown` health
 * and a `resultsError`, so the dashboard can explain what is missing.
 */
export class MonitorService {
  constructor(
    private readonly monitors: MonitorRepository,
    private readonly results: SyntheticResultRepository,
    private readonly scope: Scope,
  ) {}

  get(id: string): SyntheticMonitor {
    const monitor = this.monitors.getInScope(this.scope, id);
    if (!monitor) throw new NotFoundError('Monitor');
    return monitor;
  }

  async list(range: TimeRange): Promise<MonitorListResponse> {
    const window = timeWindow(range);
    const monitors = this.monitors.list(this.scope);
    const { withSummary, resultsError } = await this.summarize(monitors, window);
    return { range, monitors: withSummary, resultsError };
  }

  async detail(id: string, range: TimeRange): Promise<MonitorResponse> {
    const monitor = this.get(id);
    const { withSummary, resultsError } = await this.summarize([monitor], timeWindow(range));
    return { range, monitor: withSummary[0]!, resultsError };
  }

  async series(id: string, range: TimeRange) {
    this.get(id);
    const window = timeWindow(range);
    const rows = await this.results.series(this.scope, [id], window.fromMs, window.stepSeconds);
    return { range, stepSeconds: window.stepSeconds, points: fillSeries(window, rows) };
  }

  async checks(id: string, limit: number) {
    this.get(id);
    return { checks: await this.results.recentChecks(this.scope, id, limit) };
  }

  async overview(range: TimeRange): Promise<OverviewResponse> {
    const window = timeWindow(range);
    const monitors = this.monitors.list(this.scope);
    const ids = monitors.map((monitor) => monitor.id);
    let { withSummary, resultsError } = await this.summarize(monitors, window);

    let totals: Totals = { checks: 0, failures: 0, p95LatencyMs: null, avgLatencyMs: null };
    let points = fillSeries(window, []);
    if (ids.length > 0 && !resultsError) {
      try {
        const [loadedTotals, rows] = await Promise.all([
          this.results.totals(this.scope, ids, window.fromMs),
          this.results.series(this.scope, ids, window.fromMs, window.stepSeconds),
        ]);
        totals = loadedTotals;
        points = fillSeries(window, rows);
      } catch (error) {
        resultsError = toResultsError(error);
      }
    }

    const counts = { total: monitors.length, healthy: 0, degraded: 0, critical: 0, unknown: 0, paused: 0 };
    for (const monitor of withSummary) {
      if (!monitor.enabled) counts.paused += 1;
      else counts[monitor.summary.health] += 1;
    }

    return {
      range,
      counts,
      checks: totals.checks,
      failures: totals.failures,
      availability: totals.checks > 0 ? (totals.checks - totals.failures) / totals.checks : null,
      p95LatencyMs: totals.p95LatencyMs,
      avgLatencyMs: totals.avgLatencyMs,
      series: { range, stepSeconds: window.stepSeconds, points },
      monitors: withSummary,
      resultsError,
    };
  }

  private async summarize(
    monitors: readonly SyntheticMonitor[],
    window: TimeWindow,
  ): Promise<{ withSummary: MonitorWithSummary[]; resultsError: ApiErrorBody | null }> {
    let raw = new Map<string, RawMonitorSummary>();
    let resultsError: ApiErrorBody | null = null;
    if (monitors.length > 0) {
      try {
        raw = await this.results.summaries(
          this.scope,
          monitors.map((monitor) => monitor.id),
          window.fromMs,
        );
      } catch (error) {
        resultsError = toResultsError(error);
      }
    }

    const now = Date.now();
    const withSummary = monitors.map((monitor) => ({
      ...monitor,
      summary: buildSummary(monitor, raw.get(monitor.id), now, resultsError !== null),
    }));
    return { withSummary, resultsError };
  }
}

function toResultsError(error: unknown): ApiErrorBody {
  if (error instanceof ClickHouseUnavailableError) return { code: error.code, message: error.message };
  throw error;
}

function buildSummary(
  monitor: SyntheticMonitor,
  raw: RawMonitorSummary | undefined,
  now: number,
  resultsUnavailable: boolean,
): MonitorSummary {
  const health = resultsUnavailable
    ? { health: 'unknown' as const, reason: 'Results unavailable', stale: false }
    : deriveHealth({
        enabled: monitor.enabled,
        intervalSeconds: monitor.intervalSeconds,
        lastStatus: raw?.lastStatus ?? null,
        lastCheckedAt: raw?.lastCheckedAt ?? null,
        recentStatuses: raw?.recentStatuses ?? [],
        sslExpiresAt: raw?.sslExpiresAt ?? null,
        now,
      });

  const checks = raw?.checks ?? 0;
  const failures = raw?.failures ?? 0;
  return {
    health: health.health,
    healthReason: health.reason,
    stale: health.stale,
    lastStatus: raw?.lastStatus ?? null,
    lastStatusCode: raw?.lastStatusCode ?? null,
    lastLatencyMs: raw?.lastLatencyMs ?? null,
    lastError: raw?.lastError || null,
    lastCheckedAt: raw?.lastCheckedAt ?? null,
    availability: checks > 0 ? (checks - failures) / checks : null,
    checks,
    failures,
    p95LatencyMs: raw?.p95LatencyMs ?? null,
    avgLatencyMs: raw?.avgLatencyMs ?? null,
    sslExpiresAt: raw?.sslExpiresAt ?? null,
  };
}
