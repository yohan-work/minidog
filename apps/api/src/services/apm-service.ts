import { RETENTION_MAX_DAYS,
  SERVICE_CURRENT_WINDOW_SECONDS,
  TIME_RANGES,
  type EndpointListResponse,
  type EndpointResponse,
  type EndpointSummary,
  type RequestSeries,
  type RequestSeriesPoint,
  type ServiceListResponse,
  type ServiceMapEdge,
  type ServiceMapNode,
  type ServiceMapResponse,
  type ServiceResponse,
  type DbQueryListResponse,
  type DbQuerySort,
  type ErrorListResponse,
  type ServiceSummary,
  type TimeRange,
  type TraceListResponse,
  type TraceResponse,
} from '@minidog/types';
import { NotFoundError } from '../lib/errors';
import { queryBounds, timeWindow, type TimeWindow } from '../lib/time-window';
import type { LogRepository } from '../repositories/log-repository';
import type { Scope } from '../repositories/project-repository';
import type { RawEndpoint, RawRequestPoint, RawServiceStats, SpanRepository, TraceFilters } from '../repositories/span-repository';
import { deriveDeployments, summarizeVersions } from './deployments';
import { fillHistogram } from './histogram';
import { deriveServiceHealth } from './service-health';

/** As far back as spans can be kept; a service page opens for any service seen within it. */
const LOOKBACK_MS = RETENTION_MAX_DAYS * 24 * 60 * 60 * 1000;

/** `from`/`to` (epoch ms) is an absolute window selected on a chart; it overrides `range`. */
export type TraceQuery = Omit<TraceFilters, 'fromMs' | 'toMs'> & { range: TimeRange; from?: number; to?: number };

export interface DbQueryQuery {
  range: TimeRange;
  from?: number;
  to?: number;
  service?: string;
  sort: DbQuerySort;
  limit: number;
}

export interface ErrorQuery {
  range: TimeRange;
  from?: number;
  to?: number;
  service?: string;
  limit: number;
}

/** Services, endpoints and traces, derived from entry spans. */
export class ApmService {
  constructor(
    private readonly spans: SpanRepository,
    private readonly logs: LogRepository,
    private readonly scope: Scope,
  ) {}

  async list(range: TimeRange, options: { deployments: boolean } = { deployments: false }): Promise<ServiceListResponse> {
    const now = Date.now();
    const window = timeWindow(range, now);
    const statsWindow = this.statsWindow(window, now);
    const [stats, totals, points, versions] = await Promise.all([
      this.spans.serviceStats(this.scope, { ...statsWindow, lookbackFromMs: statsWindow.previousFromMs }),
      this.spans.totals(this.scope, window.fromMs),
      this.spans.requestSeries(this.scope, window.fromMs, window.stepSeconds),
      options.deployments
        ? this.spans.versionStats(this.scope, { fromMs: window.fromMs, lookbackFromMs: now - LOOKBACK_MS })
        : Promise.resolve([]),
    ]);

    return {
      range,
      services: stats
        .filter((raw) => raw.requests > 0 || raw.currentRequests > 0)
        .map((raw) => toServiceSummary(raw, range)),
      totals: { ...totals, errorRate: totals.requests > 0 ? totals.errors / totals.requests : null },
      series: fillRequestSeries(window, points),
      deployments: deriveDeployments(versions, window.fromMs),
    };
  }

  async detail(service: string, range: TimeRange): Promise<ServiceResponse> {
    const now = Date.now();
    const window = timeWindow(range, now);
    const [[stats], points, endpoints, versions] = await Promise.all([
      this.spans.serviceStats(this.scope, { ...this.statsWindow(window, now), lookbackFromMs: now - LOOKBACK_MS }, service),
      this.spans.requestSeries(this.scope, window.fromMs, window.stepSeconds, service),
      this.spans.endpoints(this.scope, window.fromMs, service),
      this.spans.versionStats(this.scope, { fromMs: window.fromMs, lookbackFromMs: now - LOOKBACK_MS, service }),
    ]);
    if (!stats) throw new NotFoundError('Service');

    return {
      range,
      service: toServiceSummary(stats, range),
      series: fillRequestSeries(window, points),
      endpoints: endpoints.map(toEndpointSummary),
      deployments: deriveDeployments(versions, window.fromMs),
      versions: summarizeVersions(versions, window.fromMs),
    };
  }

  /** One endpoint of a service: summary, trend and response-time distribution. */
  async endpoint(service: string, endpoint: string, range: TimeRange): Promise<EndpointResponse> {
    const now = Date.now();
    const window = timeWindow(range, now);
    const [[raw], points, bins] = await Promise.all([
      this.spans.endpoints(this.scope, window.fromMs, service, endpoint),
      this.spans.requestSeries(this.scope, window.fromMs, window.stepSeconds, service, endpoint),
      this.spans.latencyHistogram(this.scope, { fromMs: window.fromMs, service, endpoint }),
    ]);
    if (!raw) throw new NotFoundError('Endpoint');
    return {
      range,
      endpoint: toEndpointSummary(raw),
      series: fillRequestSeries(window, points),
      histogram: fillHistogram(bins),
    };
  }

  /** Endpoints of every service, slowest first — used to point at a likely cause. */
  async endpoints(range: TimeRange): Promise<EndpointListResponse> {
    const window = timeWindow(range);
    return { range, endpoints: (await this.spans.endpoints(this.scope, window.fromMs)).map(toEndpointSummary) };
  }

  /** Services and databases with the calls between them, derived from span parent/child links. */
  async map(range: TimeRange): Promise<ServiceMapResponse> {
    const now = Date.now();
    const window = timeWindow(range, now);
    const statsWindow = this.statsWindow(window, now);
    const [stats, serviceEdges, databaseEdges] = await Promise.all([
      this.spans.serviceStats(this.scope, { ...statsWindow, lookbackFromMs: statsWindow.previousFromMs }),
      this.spans.serviceEdges(this.scope, window.fromMs),
      this.spans.databaseEdges(this.scope, window.fromMs),
    ]);
    const seconds = TIME_RANGES[range].seconds;

    const nodes = new Map<string, ServiceMapNode>();
    for (const raw of stats.filter((item) => item.requests > 0 || item.currentRequests > 0)) {
      const summary = toServiceSummary(raw, range);
      nodes.set(raw.service, {
        id: raw.service,
        kind: 'service',
        name: raw.service,
        health: summary.health,
        requestsPerSecond: summary.requestsPerSecond,
        errorRate: summary.errorRate,
        p95Ms: summary.p95Ms,
      });
    }

    const edge = (raw: { source: string; target: string; calls: number; errors: number; p95Ms: number | null }): ServiceMapEdge => ({
      source: raw.source,
      target: raw.target,
      calls: raw.calls,
      callsPerSecond: raw.calls / seconds,
      errorRate: raw.calls > 0 ? raw.errors / raw.calls : 0,
      p95Ms: raw.p95Ms,
    });

    const edges: ServiceMapEdge[] = serviceEdges.map(edge);
    for (const raw of databaseEdges) {
      const id = `db:${raw.target}`;
      const existing = nodes.get(id);
      const rate = raw.calls > 0 ? raw.errors / raw.calls : 0;
      nodes.set(id, {
        id,
        kind: 'database',
        name: raw.target,
        health: 'unknown',
        requestsPerSecond: (existing?.requestsPerSecond ?? 0) + raw.calls / seconds,
        errorRate: rate,
        p95Ms: raw.p95Ms,
      });
      edges.push(edge({ ...raw, target: id }));
    }
    // Callers that only appear as a source still need a node.
    for (const item of edges) {
      for (const id of [item.source, item.target]) {
        if (!nodes.has(id)) {
          nodes.set(id, { id, kind: 'service', name: id, health: 'unknown', requestsPerSecond: null, errorRate: null, p95Ms: null });
        }
      }
    }

    return { range, nodes: [...nodes.values()], edges };
  }

  async traces(query: TraceQuery): Promise<TraceListResponse> {
    const { range, from, to, ...filters } = query;
    const traces = await this.spans.traces(this.scope, { ...filters, ...queryBounds(range, from, to) });
    return { range, traces, truncated: traces.length >= filters.limit };
  }

  /** Database statements ranked by time spent, P95 or calls. */
  async queries({ range, from, to, service, sort, limit }: DbQueryQuery): Promise<DbQueryListResponse> {
    const queries = await this.spans.slowQueries(this.scope, { ...queryBounds(range, from, to), service, sort, limit });
    return { range, sort, queries, truncated: queries.length >= limit };
  }

  /** Recorded exceptions grouped by type and message. */
  async errors({ range, from, to, service, limit }: ErrorQuery): Promise<ErrorListResponse> {
    const groups = await this.spans.errorGroups(this.scope, { ...queryBounds(range, from, to), service, limit });
    return { range, groups, truncated: groups.length >= limit };
  }

  async trace(traceId: string): Promise<TraceResponse> {
    const [spans, logCount] = await Promise.all([
      this.spans.trace(this.scope, traceId),
      this.logs.countByTrace(this.scope, traceId),
    ]);
    if (spans.length === 0) throw new NotFoundError('Trace');
    return { traceId, spans, logCount };
  }

  private statsWindow(window: TimeWindow, now: number) {
    const lengthMs = (window.endSeconds - window.startSeconds + window.stepSeconds) * 1000;
    return {
      fromMs: window.fromMs,
      previousFromMs: window.fromMs - lengthMs,
      currentFromMs: now - SERVICE_CURRENT_WINDOW_SECONDS * 1000,
    };
  }
}

function toServiceSummary(raw: RawServiceStats, range: TimeRange): ServiceSummary {
  const { health, reason } = deriveServiceHealth({
    requests: raw.currentRequests,
    errors: raw.currentErrors,
    p95Ms: raw.currentP95Ms,
  });
  return {
    service: raw.service,
    health,
    healthReason: reason,
    requests: raw.requests,
    requestsPerSecond: raw.requests / TIME_RANGES[range].seconds,
    errors: raw.errors,
    errorRate: raw.requests > 0 ? raw.errors / raw.requests : null,
    p50Ms: raw.p50Ms,
    p95Ms: raw.p95Ms,
    p99Ms: raw.p99Ms,
    p95Change: raw.p95Ms !== null && raw.previousP95Ms ? raw.p95Ms / raw.previousP95Ms - 1 : null,
    lastSeenAt: raw.lastSeenAt,
    hosts: raw.hosts,
  };
}

function toEndpointSummary(raw: RawEndpoint): EndpointSummary {
  return { ...raw, errorRate: raw.requests > 0 ? raw.errors / raw.requests : 0 };
}

/** One point per bucket; buckets without requests carry zero counts and null latency. */
export function fillRequestSeries(window: TimeWindow, rows: readonly RawRequestPoint[]): RequestSeries {
  const byBucket = new Map(rows.map((row) => [row.t, row]));
  const points: RequestSeriesPoint[] = [];
  for (let t = window.startSeconds; t <= window.endSeconds; t += window.stepSeconds) {
    points.push(byBucket.get(t) ?? { t, requests: 0, errors: 0, p50Ms: null, p95Ms: null, p99Ms: null });
  }
  return { range: window.range, stepSeconds: window.stepSeconds, points };
}
