/**
 * Shared contracts between the Query API and the Web Dashboard.
 */

export type HealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown';
export type CheckStatus = 'up' | 'down';
export type HttpMethod = 'GET' | 'HEAD';

export type SpanKind = 'unspecified' | 'internal' | 'server' | 'client' | 'producer' | 'consumer';
export type SpanStatus = 'unset' | 'ok' | 'error';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

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
  /** Where telemetry is sent; shown as connection info. */
  ingest: {
    /** Ingestion API base URL (OTLP/HTTP JSON at /v1/{traces,metrics,logs}). */
    apiUrl: string;
    /** Bundled OpenTelemetry Collector OTLP/HTTP endpoint. */
    collectorUrl: string;
    /** When false, data without an API key goes to the default project. */
    requireApiKey: boolean;
  };
}

// ---------------------------------------------------------------------------
// Projects and API keys
// ---------------------------------------------------------------------------

export interface EnvironmentInfo {
  name: string;
  createdAt: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: string;
  environments: EnvironmentInfo[];
}

export interface ProjectListResponse {
  projects: ProjectInfo[];
  active: { projectId: string; environment: string };
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  environment: string;
  /** First characters of the key, e.g. `mdg_4k2j9x`. The full key is shown once. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyListResponse {
  apiKeys: ApiKeyInfo[];
}

export interface CreateApiKeyResponse {
  apiKey: ApiKeyInfo;
  /** The full key. It is not stored and cannot be shown again. */
  secret: string;
}

/** Header that carries an API key on OTLP requests (Authorization: Bearer also works). */
export const API_KEY_HEADER = 'x-minidog-api-key';

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

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

/** Current host values are averaged over this trailing window. */
export const HOST_CURRENT_WINDOW_SECONDS = 5 * 60;

/** Utilization (0..1) at which a host is degraded or critical. */
export const HOST_THRESHOLDS = { degraded: 0.85, critical: 0.95 } as const;

export interface HostSummary {
  /** `host.name` resource attribute. */
  host: string;
  /** `os.type` resource attribute, e.g. `linux`. */
  os: string | null;
  health: HealthStatus;
  /** Short cause of the current health, e.g. `Disk 96% on /`. */
  healthReason: string | null;
  /** Epoch milliseconds of the newest data point. */
  lastSeenAt: number;
  /** Utilization 0..1 over the current window. */
  cpu: number | null;
  memory: number | null;
  /** Utilization of the fullest filesystem, 0..1. */
  disk: number | null;
  diskMountpoint: string | null;
  /** Bytes per second over the current window. */
  networkRxBps: number | null;
  networkTxBps: number | null;
}

export interface HostListResponse {
  range: TimeRange;
  hosts: HostSummary[];
}

export interface HostSeriesPoint {
  /** Bucket start, epoch seconds. */
  t: number;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  networkRxBps: number | null;
  networkTxBps: number | null;
}

export interface HostResponse {
  range: TimeRange;
  host: HostSummary;
  series: { range: TimeRange; stepSeconds: number; points: HostSeriesPoint[] };
}

// ---------------------------------------------------------------------------
// APM
// ---------------------------------------------------------------------------

/** Service health is judged on this trailing window. */
export const SERVICE_CURRENT_WINDOW_SECONDS = 15 * 60;

export const SERVICE_THRESHOLDS = {
  errorRate: { degraded: 0.02, critical: 0.1 },
  p95Ms: { degraded: 1_000, critical: 3_000 },
  /** Below this many requests a rate is not meaningful. */
  minRequests: 5,
} as const;

export interface LatencyStats {
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface ServiceSummary extends LatencyStats {
  service: string;
  health: HealthStatus;
  healthReason: string | null;
  /** Entry spans (server, consumer, root) in the selected range. */
  requests: number;
  requestsPerSecond: number;
  errors: number;
  errorRate: number | null;
  /** P95 relative to the previous period of the same length: 3.12 = +312%. */
  p95Change: number | null;
  /** Epoch milliseconds. */
  lastSeenAt: number;
  hosts: string[];
}

export interface RequestSeriesPoint extends LatencyStats {
  /** Bucket start, epoch seconds. */
  t: number;
  requests: number;
  errors: number;
}

export interface RequestSeries {
  range: TimeRange;
  stepSeconds: number;
  points: RequestSeriesPoint[];
}

export interface EndpointSummary extends LatencyStats {
  service: string;
  /** `POST /checkout` */
  endpoint: string;
  requests: number;
  errors: number;
  errorRate: number;
}

export interface RequestTotals extends LatencyStats {
  requests: number;
  errors: number;
  errorRate: number | null;
}

/** A new `service.version` replacing an earlier one, i.e. a deployment. */
export interface Deployment {
  service: string;
  version: string;
  previousVersion: string;
  /** First span with the new version, epoch ms. */
  at: number;
}

/** Entry-span statistics of one version of a service. */
export interface VersionSummary {
  version: string;
  /** Epoch ms, within the 14-day lookback. */
  firstSeenAt: number;
  lastSeenAt: number;
  /** In the selected range. */
  requests: number;
  errors: number;
  errorRate: number | null;
  p95Ms: number | null;
}

export interface ServiceListResponse {
  range: TimeRange;
  services: ServiceSummary[];
  totals: RequestTotals;
  series: RequestSeries;
  /** Deployments of any service in the range, oldest first; empty unless requested with `?deployments=1`. */
  deployments: Deployment[];
}

export interface ServiceResponse {
  range: TimeRange;
  service: ServiceSummary;
  series: RequestSeries;
  endpoints: EndpointSummary[];
  /** Deployments of this service in the range, oldest first. */
  deployments: Deployment[];
  /** Versions active or deployed in the range, newest first. */
  versions: VersionSummary[];
}

export interface TraceSummary {
  traceId: string;
  spanId: string;
  /** Epoch milliseconds (fractional). */
  timestamp: number;
  service: string;
  /** Endpoint of the entry span, or its span name. */
  name: string;
  durationMs: number;
  error: boolean;
  httpStatus: number | null;
  statusMessage: string;
}

export interface TraceListResponse {
  range: TimeRange;
  traces: TraceSummary[];
  /** True when the result hit the limit. */
  truncated: boolean;
}

/** Trace list order: newest first, or slowest first (to find what made a window slow). */
export const TRACE_SORTS = ['recent', 'slowest'] as const;
export type TraceSort = (typeof TRACE_SORTS)[number];

/** Exceptions recorded on spans (`span.recordException`), grouped by type and message. */
export interface ErrorGroup {
  /** `exception.type`, e.g. `TypeError`; '' when the SDK did not set it. */
  type: string;
  /** `exception.message`. */
  message: string;
  services: string[];
  /** Recorded exception events; one request can record the same exception on several nested spans. */
  count: number;
  /** Requests (traces) affected; groups are ordered by this. */
  traces: number;
  /** Epoch milliseconds. */
  firstSeenAt: number;
  lastSeenAt: number;
  /** Endpoints of the requests that raised them. */
  endpoints: string[];
  latestTraceId: string;
}

export interface ErrorListResponse {
  range: TimeRange;
  groups: ErrorGroup[];
  /** True when the result hit the limit. */
  truncated: boolean;
}

/** Order of the query ranking: time spent (calls × duration), P95, or calls. */
export const DB_QUERY_SORTS = ['total', 'p95', 'calls'] as const;
export type DbQuerySort = (typeof DB_QUERY_SORTS)[number];

/** Database client spans with the same statement shape (literals replaced by `?`). */
export interface DbQuerySummary {
  service: string;
  /** `db.system.name`, e.g. `postgresql`. */
  dbSystem: string;
  statement: string;
  /** `db.collection.name` (table); '' when not reported. */
  collection: string;
  calls: number;
  errors: number;
  errorRate: number | null;
  /** Time spent in this statement in the window. */
  totalMs: number;
  avgMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  /** The slowest call, to open in its trace. */
  slowestTraceId: string;
  slowestSpanId: string;
}

export interface DbQueryListResponse {
  range: TimeRange;
  sort: DbQuerySort;
  queries: DbQuerySummary[];
  /** True when the result hit the limit. */
  truncated: boolean;
}

export interface SpanEvent {
  timeUnixMs: number | null;
  name: string;
  attributes: Record<string, string>;
}

export interface SpanDetail {
  spanId: string;
  parentSpanId: string;
  service: string;
  host: string;
  name: string;
  kind: SpanKind;
  /** Epoch milliseconds (fractional). */
  startMs: number;
  durationMs: number;
  status: SpanStatus;
  statusMessage: string;
  httpMethod: string;
  httpRoute: string;
  httpStatus: number | null;
  dbSystem: string;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  events: SpanEvent[];
}

export interface TraceResponse {
  traceId: string;
  spans: SpanDetail[];
  /** Log records carrying this trace id. */
  logCount: number;
}

export interface EndpointListResponse {
  range: TimeRange;
  endpoints: EndpointSummary[];
}

// ---------------------------------------------------------------------------
// Service map
// ---------------------------------------------------------------------------

export interface ServiceMapNode {
  /** Service name, or `db:<system>` for a database. */
  id: string;
  kind: 'service' | 'database';
  name: string;
  health: HealthStatus;
  requestsPerSecond: number | null;
  errorRate: number | null;
  p95Ms: number | null;
}

export interface ServiceMapEdge {
  source: string;
  target: string;
  calls: number;
  callsPerSecond: number;
  errorRate: number;
  /** P95 of the called span. */
  p95Ms: number | null;
}

export interface ServiceMapResponse {
  range: TimeRange;
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
}

// ---------------------------------------------------------------------------
// Monitors (alerting)
// ---------------------------------------------------------------------------

export const ALERT_MONITOR_TYPES = ['service_down', 'error_rate', 'latency', 'host_resource', 'synthetic_check'] as const;
export type AlertMonitorType = (typeof ALERT_MONITOR_TYPES)[number];

export const HOST_RESOURCE_METRICS = ['cpu', 'memory', 'disk'] as const;
export type HostResourceMetric = (typeof HOST_RESOURCE_METRICS)[number];

/** Signals of a synthetic_check monitor: failed checks (%), P95 response time (ms), days until SSL expiry. */
export const SYNTHETIC_ALERT_METRICS = ['failure_rate', 'response_time', 'ssl_days'] as const;
export type SyntheticAlertMetric = (typeof SYNTHETIC_ALERT_METRICS)[number];

export const ALERT_METRICS = [...HOST_RESOURCE_METRICS, ...SYNTHETIC_ALERT_METRICS] as const;
export type AlertMetric = HostResourceMetric | SyntheticAlertMetric;

export function isHostResourceMetric(value: unknown): value is HostResourceMetric {
  return (HOST_RESOURCE_METRICS as readonly unknown[]).includes(value);
}

export function isSyntheticAlertMetric(value: unknown): value is SyntheticAlertMetric {
  return (SYNTHETIC_ALERT_METRICS as readonly unknown[]).includes(value);
}

export type AlertState = 'ok' | 'warning' | 'critical' | 'no_data';

export const ALERT_WINDOWS_MINUTES = [1, 5, 10, 15, 30, 60] as const;

/** How long a worse (or better) state must last before the monitor enters it. 0 = immediately. */
export const ALERT_DELAYS_MINUTES = [0, 1, 2, 5, 10, 15, 30] as const;

/** Mute durations offered in the dashboard. */
export const ALERT_MUTE_MINUTES = [30, 60, 240, 1440] as const;

export interface AlertDefaults {
  warning: number | null;
  critical: number;
  windowMinutes: number;
}

/**
 * Thresholds by type. Units: service_down — requests in the window (alerts
 * when fewer arrive); error_rate and host_resource — percent; latency — P95 ms;
 * synthetic_check — see SYNTHETIC_ALERT_DEFAULTS (failure rate shown here).
 */
export const ALERT_MONITOR_DEFAULTS: Record<AlertMonitorType, AlertDefaults> = {
  service_down: { warning: null, critical: 1, windowMinutes: 5 },
  error_rate: { warning: 2, critical: 10, windowMinutes: 5 },
  latency: { warning: 1_000, critical: 2_000, windowMinutes: 5 },
  host_resource: { warning: 85, critical: 95, windowMinutes: 5 },
  synthetic_check: { warning: null, critical: 50, windowMinutes: 5 },
};

/** failure_rate — % of failed checks; response_time — P95 ms; ssl_days — days left (alerts below). */
export const SYNTHETIC_ALERT_DEFAULTS: Record<SyntheticAlertMetric, AlertDefaults> = {
  failure_rate: { warning: null, critical: 50, windowMinutes: 5 },
  response_time: { warning: 1_000, critical: 3_000, windowMinutes: 5 },
  ssl_days: { warning: 14, critical: 7, windowMinutes: 60 },
};

export function alertDefaults(type: AlertMonitorType, metric: AlertMetric | null): AlertDefaults {
  if (type === 'synthetic_check') return SYNTHETIC_ALERT_DEFAULTS[isSyntheticAlertMetric(metric) ? metric : 'failure_rate'];
  return ALERT_MONITOR_DEFAULTS[type];
}

/**
 * `above`: alert when the value rises to a threshold. `below`: alert when it
 * falls under it — requests for Service down, days left for SSL expiry.
 */
export type AlertDirection = 'above' | 'below';

export function alertDirection(type: AlertMonitorType, metric: AlertMetric | null): AlertDirection {
  if (type === 'service_down') return 'below';
  if (type === 'synthetic_check' && metric === 'ssl_days') return 'below';
  return 'above';
}

/** SSL expiry is judged on the latest certificate; every other signal on its window. */
export function usesWindow(type: AlertMonitorType, metric: AlertMetric | null): boolean {
  return !(type === 'synthetic_check' && metric === 'ssl_days');
}

export interface AlertMonitor {
  id: string;
  name: string;
  type: AlertMonitorType;
  /** Service name; host name for host_resource; synthetic monitor id for synthetic_check. */
  target: string;
  /** Display name of the target (the synthetic monitor's name for synthetic_check). */
  targetLabel: string;
  /** host_resource and synthetic_check only. */
  metric: AlertMetric | null;
  warningThreshold: number | null;
  criticalThreshold: number;
  windowMinutes: number;
  /** Optional; state changes are POSTed as JSON. */
  webhookUrl: string;
  /** Minutes a worse state must last before the monitor enters it (and notifies). */
  alertAfterMinutes: number;
  /** Minutes a better state must last before recovery is reported. */
  recoverAfterMinutes: number;
  /** ISO time until which webhooks are held; states are still recorded. */
  mutedUntil: string | null;
  enabled: boolean;
  state: AlertState;
  /** State the measurements point to while alertAfter/recoverAfter is running. */
  pendingState: AlertState | null;
  pendingSince: string | null;
  /** Last measured value, in the unit of the type. */
  stateValue: number | null;
  stateMessage: string;
  stateChangedAt: string | null;
  lastEvaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  monitorId: string;
  monitorName: string;
  fromState: AlertState;
  toState: AlertState;
  value: number | null;
  message: string;
  createdAt: string;
  /** Read in the dashboard. */
  acknowledged: boolean;
  /** '' when no webhook is configured, otherwise `sent 200`, `failed …` or `muted` (held until the mute ends). */
  webhookStatus: string;
}

export interface CreateAlertMonitorInput {
  name?: string;
  type: AlertMonitorType;
  target: string;
  metric?: AlertMetric;
  warningThreshold?: number | null;
  criticalThreshold?: number;
  windowMinutes?: number;
  webhookUrl?: string;
  alertAfterMinutes?: number;
  recoverAfterMinutes?: number;
}

export type UpdateAlertMonitorInput = Partial<
  Pick<
    AlertMonitor,
    'name' | 'warningThreshold' | 'criticalThreshold' | 'windowMinutes' | 'webhookUrl' | 'enabled' | 'alertAfterMinutes' | 'recoverAfterMinutes'
  >
>;

export interface AlertMonitorListResponse {
  monitors: AlertMonitor[];
}

export interface AlertMonitorResponse {
  monitor: AlertMonitor;
  events: AlertEvent[];
}

export interface AlertSummaryResponse {
  /** Monitors in warning or critical, most severe first. */
  active: AlertMonitor[];
  /** State changes not yet acknowledged in the dashboard. */
  unread: number;
  recent: AlertEvent[];
}

// ---------------------------------------------------------------------------
// Metrics explorer
// ---------------------------------------------------------------------------

export const METRIC_AGGREGATIONS = ['avg', 'min', 'max', 'sum', 'p95', 'rate'] as const;
export type MetricAggregation = (typeof METRIC_AGGREGATIONS)[number];

/** At most this many series are drawn; the rest are summarised in the table. */
export const METRIC_MAX_GROUPS = 6;

export interface MetricCatalogEntry {
  name: string;
  /** UCUM unit as sent, e.g. `By`, `1`, `{order}`. */
  unit: string;
  type: 'gauge' | 'sum';
  temporality: '' | 'delta' | 'cumulative';
  services: string[];
  hosts: string[];
  attributeKeys: string[];
}

export interface MetricCatalogResponse {
  range: TimeRange;
  metrics: MetricCatalogEntry[];
}

export interface MetricGroupSeries {
  /** Group value; '' when not grouped. */
  key: string;
  values: (number | null)[];
}

export interface MetricQueryResponse {
  range: TimeRange;
  metric: string;
  unit: string;
  aggregation: MetricAggregation;
  stepSeconds: number;
  /** Bucket starts, epoch seconds. */
  timestamps: number[];
  /** Largest groups first. */
  groups: MetricGroupSeries[];
  /** Groups beyond METRIC_MAX_GROUPS that were left out. */
  omittedGroups: number;
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export interface LogEntry {
  /** Epoch milliseconds (fractional). */
  timestamp: number;
  service: string;
  host: string;
  level: LogLevel;
  severityText: string;
  body: string;
  traceId: string;
  spanId: string;
  attributes: Record<string, string>;
}

export interface LogVolumePoint {
  /** Bucket start, epoch seconds. */
  t: number;
  total: number;
  /** error and fatal records. */
  errors: number;
}

export interface LogListResponse {
  range: TimeRange;
  logs: LogEntry[];
  /** True when the result hit the limit. */
  truncated: boolean;
  /** Volume over the range; empty when filtering by trace. */
  series: { stepSeconds: number; points: LogVolumePoint[] };
  /** Services with logs in the range, for the service filter. */
  services: string[];
}
