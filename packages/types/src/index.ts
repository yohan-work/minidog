/**
 * Shared contracts between the Query API and the Web Dashboard.
 */

export type HealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown';
export type CheckStatus = 'up' | 'down';
export type HttpMethod = 'GET' | 'HEAD';

// ---------------------------------------------------------------------------
// Time range
// ---------------------------------------------------------------------------

export const TIME_RANGES = {
  '1h': { seconds: 60 * 60, stepSeconds: 60, label: 'Last 1 hour' },
  '6h': { seconds: 6 * 60 * 60, stepSeconds: 5 * 60, label: 'Last 6 hours' },
  '24h': { seconds: 24 * 60 * 60, stepSeconds: 15 * 60, label: 'Last 24 hours' },
  '7d': { seconds: 7 * 24 * 60 * 60, stepSeconds: 2 * 60 * 60, label: 'Last 7 days' },
} as const;

export type TimeRange = keyof typeof TIME_RANGES;
export const TIME_RANGE_KEYS = Object.keys(TIME_RANGES) as [TimeRange, ...TimeRange[]];
export const DEFAULT_TIME_RANGE: TimeRange = '1h';

export function isTimeRange(value: unknown): value is TimeRange {
  return typeof value === 'string' && Object.hasOwn(TIME_RANGES, value);
}

// ---------------------------------------------------------------------------
// Synthetic monitors
// ---------------------------------------------------------------------------

export const MONITOR_INTERVALS_SECONDS = [30, 60, 300, 600, 900, 1800, 3600] as const;
export const MONITOR_TIMEOUT_MS = { min: 1_000, max: 30_000 } as const;
export const MONITOR_DEFAULTS = {
  method: 'GET',
  intervalSeconds: 60,
  timeoutMs: 10_000,
  expectedStatus: '200-399',
} as const satisfies {
  method: HttpMethod;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: string;
};

export interface SyntheticMonitor {
  id: string;
  projectId: string;
  environment: string;
  name: string;
  url: string;
  method: HttpMethod;
  intervalSeconds: number;
  timeoutMs: number;
  /** Accepted status codes, e.g. `200-399` or `200,301-302`. */
  expectedStatus: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorSummary {
  health: HealthStatus;
  /** Short, human readable cause of the current health, e.g. `Failed 2 of last 5 checks`. */
  healthReason: string | null;
  /** True when the last check is older than the schedule allows. */
  stale: boolean;
  lastStatus: CheckStatus | null;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  /** Epoch milliseconds. */
  lastCheckedAt: number | null;
  /** Share of successful checks in the selected range, 0..1. */
  availability: number | null;
  checks: number;
  failures: number;
  p95LatencyMs: number | null;
  avgLatencyMs: number | null;
  /** Epoch milliseconds. */
  sslExpiresAt: number | null;
}

export interface MonitorWithSummary extends SyntheticMonitor {
  summary: MonitorSummary;
}

export interface CheckResult {
  /** Epoch milliseconds. */
  timestamp: number;
  status: CheckStatus;
  statusCode: number;
  latencyMs: number;
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  /** Epoch milliseconds. */
  sslExpiresAt: number | null;
  error: string;
}

export interface SeriesPoint {
  /** Bucket start, epoch seconds. */
  t: number;
  checks: number;
  failures: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface Series {
  range: TimeRange;
  stepSeconds: number;
  points: SeriesPoint[];
}

export interface CreateMonitorInput {
  name?: string;
  url: string;
  method?: HttpMethod;
  intervalSeconds?: number;
  timeoutMs?: number;
  expectedStatus?: string;
}

export type UpdateMonitorInput = Partial<Omit<CreateMonitorInput, 'name'>> & {
  name?: string;
  enabled?: boolean;
};

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ContextResponse {
  project: { id: string; name: string };
  environment: string;
  worker: { enabled: boolean };
}

export interface MonitorListResponse {
  range: TimeRange;
  monitors: MonitorWithSummary[];
  /** Set when telemetry could not be queried; monitors are still listed. */
  resultsError: ApiErrorBody | null;
}

export interface MonitorResponse {
  range: TimeRange;
  monitor: MonitorWithSummary;
  resultsError: ApiErrorBody | null;
}

export interface MonitorChecksResponse {
  checks: CheckResult[];
}

export interface RunCheckResponse {
  check: CheckResult;
  /** False when the result could not be written to ClickHouse yet. */
  persisted: boolean;
}

export interface OverviewResponse {
  range: TimeRange;
  counts: {
    total: number;
    healthy: number;
    degraded: number;
    critical: number;
    unknown: number;
    paused: number;
  };
  checks: number;
  failures: number;
  availability: number | null;
  p95LatencyMs: number | null;
  avgLatencyMs: number | null;
  series: Series;
  monitors: MonitorWithSummary[];
  resultsError: ApiErrorBody | null;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  sqlite: 'ok';
  clickhouse: 'ok' | 'unavailable';
}
