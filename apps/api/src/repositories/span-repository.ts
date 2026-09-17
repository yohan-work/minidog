import { LATENCY_BINS_PER_DOUBLING } from '@minidog/types';
import type {
  DbQuerySort,
  DbQuerySummary,
  ErrorGroup,
  SpanEvent,
  SpanKind,
  SpanStatus,
  TraceSort,
} from '@minidog/types';
import { ClickHouseRepository } from '../db/clickhouse-repository';
import type { SpanRow } from '../ingest/otlp-traces';
import type { Scope } from './project-repository';

// ClickHouse serialises 64-bit integers as strings and empty quantiles as NaN.
type Num = number | string;
type NullableNum = Num | null;

const toMs = (value: NullableNum): number | null => {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
};

const SCOPE_FILTER = `project_id = {projectId:String} AND environment = {environment:String}`;
const since = (param: string) => `timestamp >= fromUnixTimestamp64Milli({${param}:Int64})`;
const before = (param: string) => `timestamp < fromUnixTimestamp64Milli({${param}:Int64})`;
const optional = <T>(value: T | undefined, clause: string) => (value === undefined ? '' : `AND ${clause}`);

export interface LatencyRow {
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface RawServiceStats extends LatencyRow {
  service: string;
  requests: number;
  errors: number;
  previousP95Ms: number | null;
  currentRequests: number;
  currentErrors: number;
  currentP95Ms: number | null;
  lastSeenAt: number;
  hosts: string[];
}

export interface ServiceStatsWindow {
  /** Start of the selected range. */
  fromMs: number;
  /** Start of the previous period of the same length. */
  previousFromMs: number;
  /** Start of the window that health is judged on. */
  currentFromMs: number;
  /** Services seen since this time are returned even without requests in range. */
  lookbackFromMs: number;
}

export interface RawRequestPoint extends LatencyRow {
  t: number;
  requests: number;
  errors: number;
}

export interface RawEndpoint extends LatencyRow {
  service: string;
  endpoint: string;
  requests: number;
  errors: number;
}

/** Entry spans in logarithmic duration bin `bin` (see latencyBin); bin -1 is under 1 ms. */
export interface RawLatencyBin {
  bin: number;
  requests: number;
  errors: number;
}

export interface RawEdge {
  source: string;
  target: string;
  calls: number;
  errors: number;
  p95Ms: number | null;
}

export interface TraceFilters {
  fromMs: number;
  /** Exclusive upper bound; open-ended when absent. */
  toMs?: number;
  sort?: TraceSort;
  service?: string;
  endpoint?: string;
  status?: 'error' | 'ok';
  minDurationMs?: number;
  /** Trace id, or text matched against the endpoint and span name. */
  query?: string;
  limit: number;
}

/** Entry-span statistics of one version of one service. */
export interface RawVersionRow {
  service: string;
  version: string;
  /** First and last span with this version since `lookbackFromMs`, epoch ms. */
  firstSeenAt: number;
  lastSeenAt: number;
  /** Since `fromMs`. */
  requests: number;
  errors: number;
  p95Ms: number | null;
}

export interface DbQueryFilters {
  fromMs: number;
  toMs?: number;
  service?: string;
  sort: DbQuerySort;
  limit: number;
}

// Statement normalisation, passed as query parameters so ClickHouse string
// escaping never touches the regular expressions. String literals and bare
// numbers become `?` (numbers inside names or `$1` placeholders are kept).
// Quotes inside a literal may be doubled (`''`, standard SQL) or
// backslash-escaped (`\'`, MySQL).
const STATEMENT_PATTERNS = {
  stringLiteral: String.raw`'(?:[^'\\]|\\.|'')*'`,
  numberLiteral: String.raw`(^|[^\w$.])-?\d+(?:\.\d+)?`,
  numberReplacement: String.raw`\1?`,
  whitespace: String.raw`\s+`,
};

const QUERY_ORDER: Record<DbQuerySort, string> = {
  total: 'total_ms DESC',
  p95: 'p95 DESC',
  calls: 'calls DESC',
};

export interface ErrorGroupFilters {
  fromMs: number;
  toMs?: number;
  service?: string;
  limit: number;
}

export interface RawTraceRow {
  traceId: string;
  spanId: string;
  timestamp: number;
  service: string;
  name: string;
  durationMs: number;
  error: boolean;
  httpStatus: number | null;
  statusMessage: string;
}

export interface RawSpan {
  spanId: string;
  parentSpanId: string;
  service: string;
  host: string;
  name: string;
  kind: SpanKind;
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

const LATENCY = (condition = '1') => `
  quantileIf(0.5)(duration_ms, ${condition}) AS p50,
  quantileIf(0.95)(duration_ms, ${condition}) AS p95,
  quantileIf(0.99)(duration_ms, ${condition}) AS p99`;

const latency = (row: { p50: NullableNum; p95: NullableNum; p99: NullableNum }): LatencyRow => ({
  p50Ms: toMs(row.p50),
  p95Ms: toMs(row.p95),
  p99Ms: toMs(row.p99),
});

export class SpanRepository extends ClickHouseRepository {
  async insert(rows: readonly SpanRow[]): Promise<void> {
    await this.insertRows('spans', rows);
  }

  /** Request statistics per service from entry spans. */
  async serviceStats(scope: Scope, window: ServiceStatsWindow, service?: string): Promise<RawServiceStats[]> {
    const inRange = since('fromMs');
    const inPrevious = `${since('previousFromMs')} AND timestamp < fromUnixTimestamp64Milli({fromMs:Int64})`;
    const inCurrent = since('currentFromMs');
    const lowerMs = Math.min(window.previousFromMs, window.currentFromMs, window.lookbackFromMs);

    const rows = await this.query<{
      service: string;
      requests: Num;
      errors: Num;
      p50: NullableNum;
      p95: NullableNum;
      p99: NullableNum;
      previous_p95: NullableNum;
      current_requests: Num;
      current_errors: Num;
      current_p95: NullableNum;
      last_ts: Num;
      hosts: string[];
    }>(
      `SELECT
         service,
         countIf(${inRange}) AS requests,
         countIf(${inRange} AND is_error = 1) AS errors,
         ${LATENCY(inRange)},
         quantileIf(0.95)(duration_ms, ${inPrevious}) AS previous_p95,
         countIf(${inCurrent}) AS current_requests,
         countIf(${inCurrent} AND is_error = 1) AS current_errors,
         quantileIf(0.95)(duration_ms, ${inCurrent}) AS current_p95,
         toUnixTimestamp64Milli(max(timestamp)) AS last_ts,
         groupUniqArrayIf(10)(host, host != '') AS hosts
       FROM spans
       WHERE ${SCOPE_FILTER}
         AND is_entry = 1
         AND service != ''
         ${optional(service, 'service = {service:String}')}
         AND ${since('lowerMs')}
       GROUP BY service
       ORDER BY service`,
      { ...scope, ...window, lowerMs, service },
    );

    return rows.map((row) => ({
      service: row.service,
      requests: Number(row.requests),
      errors: Number(row.errors),
      ...latency(row),
      previousP95Ms: toMs(row.previous_p95),
      currentRequests: Number(row.current_requests),
      currentErrors: Number(row.current_errors),
      currentP95Ms: toMs(row.current_p95),
      lastSeenAt: Number(row.last_ts),
      hosts: [...row.hosts].sort(),
    }));
  }

  /** Requests, errors and latency per bucket, for one service or all. */
  async requestSeries(
    scope: Scope,
    fromMs: number,
    stepSeconds: number,
    service?: string,
    endpoint?: string,
  ): Promise<RawRequestPoint[]> {
    const rows = await this.query<{
      t: Num;
      requests: Num;
      errors: Num;
      p50: NullableNum;
      p95: NullableNum;
      p99: NullableNum;
    }>(
      `SELECT
         intDiv(toUnixTimestamp(timestamp), {step:UInt32}) * {step:UInt32} AS t,
         count() AS requests,
         sum(is_error) AS errors,
         ${LATENCY()}
       FROM spans
       WHERE ${SCOPE_FILTER}
         AND is_entry = 1
         ${optional(service, 'service = {service:String}')}
         ${optional(endpoint, 'endpoint = {endpoint:String}')}
         AND ${since('fromMs')}
       GROUP BY t
       ORDER BY t`,
      { ...scope, fromMs, step: stepSeconds, service, endpoint },
    );
    return rows.map((row) => ({
      t: Number(row.t),
      requests: Number(row.requests),
      errors: Number(row.errors),
      ...latency(row),
    }));
  }

  async totals(scope: Scope, fromMs: number): Promise<{ requests: number; errors: number } & LatencyRow> {
    const [row] = await this.query<{
      requests: Num;
      errors: Num;
      p50: NullableNum;
      p95: NullableNum;
      p99: NullableNum;
    }>(
      `SELECT count() AS requests, sum(is_error) AS errors, ${LATENCY()}
       FROM spans
       WHERE ${SCOPE_FILTER} AND is_entry = 1 AND ${since('fromMs')}`,
      { ...scope, fromMs },
    );
    return row
      ? { requests: Number(row.requests), errors: Number(row.errors), ...latency(row) }
      : { requests: 0, errors: 0, p50Ms: null, p95Ms: null, p99Ms: null };
  }

  /**
   * Requests of one service between two times. Counting only: service_down asks
   * this on every pass for services that are quiet, which is most passes for the
   * side projects it watches, so it must not pay for quantiles it throws away.
   * `untilMs` is exclusive; the parameter is not called `toMs` because that name
   * belongs to the millisecond helper above.
   */
  async requestCount(scope: Scope, service: string, fromMs: number, untilMs?: number): Promise<number> {
    const [row] = await this.query<{ requests: Num }>(
      `SELECT count() AS requests
       FROM spans
       WHERE ${SCOPE_FILTER} AND is_entry = 1 AND service = {service:String} AND ${since('fromMs')}
         ${optional(untilMs, before('untilMs'))}`,
      { ...scope, service, fromMs, untilMs },
    );
    return Number(row?.requests ?? 0);
  }

  /** Requests, errors and P95 of one service since `fromMs` — used by monitors. */
  /** Requests, errors and P95 of a service from `fromMs`, up to now or to `untilMs` (exclusive). */
  async windowStats(
    scope: Scope,
    service: string,
    fromMs: number,
    untilMs?: number,
  ): Promise<{ requests: number; errors: number; p95Ms: number | null }> {
    const [row] = await this.query<{ requests: Num; errors: Num; p95: NullableNum }>(
      `SELECT count() AS requests, sum(is_error) AS errors, quantile(0.95)(duration_ms) AS p95
       FROM spans
       WHERE ${SCOPE_FILTER} AND is_entry = 1 AND service = {service:String}
         AND ${since('fromMs')}
         ${optional(untilMs, before('toMs'))}`,
      { ...scope, service, fromMs, toMs: untilMs },
    );
    return {
      requests: Number(row?.requests ?? 0),
      errors: Number(row?.errors ?? 0),
      p95Ms: row ? toMs(row.p95) : null,
    };
  }

  /**
   * Calls between services: an entry span whose parent span belongs to another
   * service. Parents may start slightly before the window.
   */
  async serviceEdges(scope: Scope, fromMs: number): Promise<RawEdge[]> {
    const rows = await this.query<{ source: string; target: string; calls: Num; errors: Num; p95: NullableNum }>(
      `SELECT p.service AS source, c.service AS target, count() AS calls, sum(c.is_error) AS errors,
              quantile(0.95)(c.duration_ms) AS p95
       FROM (
         SELECT trace_id, parent_span_id, service, is_error, duration_ms
         FROM spans
         WHERE ${SCOPE_FILTER} AND is_entry = 1 AND parent_span_id != '' AND ${since('fromMs')}
       ) AS c
       INNER JOIN (
         SELECT trace_id, span_id, service
         FROM spans
         WHERE ${SCOPE_FILTER} AND ${since('parentFromMs')}
       ) AS p
       ON c.trace_id = p.trace_id AND c.parent_span_id = p.span_id
       WHERE p.service != c.service AND p.service != '' AND c.service != ''
       GROUP BY source, target`,
      { ...scope, fromMs, parentFromMs: fromMs - 60_000 },
    );
    return rows.map((row) => ({
      source: row.source,
      target: row.target,
      calls: Number(row.calls),
      errors: Number(row.errors),
      p95Ms: toMs(row.p95),
    }));
  }

  /** Calls from services to databases, from client spans carrying `db.system`. */
  async databaseEdges(scope: Scope, fromMs: number): Promise<RawEdge[]> {
    const rows = await this.query<{ source: string; target: string; calls: Num; errors: Num; p95: NullableNum }>(
      `SELECT service AS source, db_system AS target, count() AS calls, sum(is_error) AS errors,
              quantile(0.95)(duration_ms) AS p95
       FROM spans
       WHERE ${SCOPE_FILTER} AND db_system != '' AND service != '' AND ${since('fromMs')}
       GROUP BY source, target`,
      { ...scope, fromMs },
    );
    return rows.map((row) => ({
      source: row.source,
      target: row.target,
      calls: Number(row.calls),
      errors: Number(row.errors),
      p95Ms: toMs(row.p95),
    }));
  }

  /** Endpoint statistics, slowest first. */
  async endpoints(scope: Scope, fromMs: number, service?: string, endpoint?: string): Promise<RawEndpoint[]> {
    const rows = await this.query<{
      service: string;
      endpoint: string;
      requests: Num;
      errors: Num;
      p50: NullableNum;
      p95: NullableNum;
      p99: NullableNum;
    }>(
      `SELECT service, endpoint, count() AS requests, sum(is_error) AS errors, ${LATENCY()}
       FROM spans
       WHERE ${SCOPE_FILTER}
         AND is_entry = 1
         AND endpoint != ''
         ${optional(service, 'service = {service:String}')}
         ${optional(endpoint, 'endpoint = {endpoint:String}')}
         AND ${since('fromMs')}
       GROUP BY service, endpoint
       ORDER BY p95 DESC
       LIMIT 200`,
      { ...scope, fromMs, service, endpoint },
    );
    return rows.map((row) => ({
      service: row.service,
      endpoint: row.endpoint,
      requests: Number(row.requests),
      errors: Number(row.errors),
      ...latency(row),
    }));
  }

  /**
   * Entry spans matching the filters, newest first. Without a service filter
   * only root spans are listed, so each trace appears once.
   */
  async traces(scope: Scope, filters: TraceFilters): Promise<RawTraceRow[]> {
    const rows = await this.query<{
      trace_id: string;
      span_id: string;
      ts_us: Num;
      service: string;
      endpoint: string;
      name: string;
      duration_ms: number;
      is_error: number;
      http_status: number;
      status_message: string;
    }>(
      `SELECT trace_id, span_id, toUnixTimestamp64Micro(timestamp) AS ts_us, service, endpoint, name,
              duration_ms, is_error, http_status, status_message
       FROM spans
       WHERE ${SCOPE_FILTER}
         AND is_entry = 1
         AND ${filters.service === undefined ? `parent_span_id = ''` : 'service = {service:String}'}
         ${optional(filters.endpoint, 'endpoint = {endpoint:String}')}
         ${optional(filters.status, filters.status === 'error' ? 'is_error = 1' : 'is_error = 0')}
         ${optional(filters.minDurationMs, 'duration_ms >= {minDurationMs:Float64}')}
         ${optional(
           filters.query,
           `(trace_id = lower({query:String})
             OR positionCaseInsensitive(endpoint, {query:String}) > 0
             OR positionCaseInsensitive(name, {query:String}) > 0)`,
         )}
         AND ${since('fromMs')}
         ${optional(filters.toMs, before('toMs'))}
       ORDER BY ${filters.sort === 'slowest' ? 'duration_ms DESC' : 'timestamp DESC'}
       LIMIT {limit:UInt32}`,
      { ...scope, ...filters },
    );
    return rows.map((row) => ({
      traceId: row.trace_id,
      spanId: row.span_id,
      timestamp: Number(row.ts_us) / 1000,
      service: row.service,
      name: row.endpoint || row.name,
      durationMs: toMs(row.duration_ms) ?? 0,
      error: row.is_error === 1,
      httpStatus: row.http_status || null,
      statusMessage: row.status_message,
    }));
  }

  /**
   * Exception events (`span.recordException`) grouped by type and message,
   * the ones affecting most traces first (one request often records the
   * same exception on several nested spans). Endpoints come from the entry span of the same
   * service in the same trace, i.e. the request that raised the exception.
   */
  async errorGroups(scope: Scope, filters: ErrorGroupFilters): Promise<ErrorGroup[]> {
    const rows = await this.query<{
      type: string;
      message: string;
      services: string[];
      occurrences: Num;
      traces: Num;
      first_ms: Num;
      last_ms: Num;
      endpoints: string[];
      latest_trace_id: string;
    }>(
      `SELECT
         x.type AS type,
         x.message AS message,
         groupUniqArray(10)(x.service) AS services,
         count() AS occurrences,
         uniqExact(x.trace_id) AS traces,
         toUnixTimestamp64Milli(min(x.timestamp)) AS first_ms,
         toUnixTimestamp64Milli(max(x.timestamp)) AS last_ms,
         groupUniqArrayIf(10)(e.endpoint, e.endpoint != '') AS endpoints,
         argMax(x.trace_id, x.timestamp) AS latest_trace_id
       FROM (
         SELECT timestamp, trace_id, service,
                JSONExtractString(ev, 'attributes', 'exception.type') AS type,
                JSONExtractString(ev, 'attributes', 'exception.message') AS message
         FROM spans
         ARRAY JOIN arrayFilter(e -> JSONExtractString(e, 'name') = 'exception', JSONExtractArrayRaw(events)) AS ev
         WHERE ${SCOPE_FILTER}
           AND position(events, '"exception"') > 0
           ${optional(filters.service, 'service = {service:String}')}
           AND ${since('fromMs')}
           ${optional(filters.toMs, before('toMs'))}
       ) AS x
       LEFT JOIN (
         SELECT trace_id, service, any(endpoint) AS endpoint
         FROM spans
         WHERE ${SCOPE_FILTER} AND is_entry = 1 AND ${since('entryFromMs')}
         GROUP BY trace_id, service
       ) AS e ON e.trace_id = x.trace_id AND e.service = x.service
       GROUP BY type, message
       ORDER BY traces DESC, occurrences DESC, last_ms DESC
       LIMIT {limit:UInt32}`,
      { ...scope, ...filters, entryFromMs: filters.fromMs - 60_000 },
    );
    return rows.map((row) => ({
      type: row.type,
      message: row.message,
      services: [...row.services].sort(),
      count: Number(row.occurrences),
      traces: Number(row.traces),
      firstSeenAt: Number(row.first_ms),
      lastSeenAt: Number(row.last_ms),
      endpoints: [...row.endpoints].sort(),
      latestTraceId: row.latest_trace_id,
    }));
  }

  /** Versions (`service.version` resource attribute) per service, from entry spans. */
  async versionStats(
    scope: Scope,
    window: { fromMs: number; lookbackFromMs: number; service?: string },
  ): Promise<RawVersionRow[]> {
    const rows = await this.query<{
      service: string;
      version: string;
      first_ms: Num;
      last_ms: Num;
      requests: Num;
      errors: Num;
      p95: NullableNum;
    }>(
      `SELECT
         service,
         resource_attributes['service.version'] AS version,
         toUnixTimestamp64Milli(min(timestamp)) AS first_ms,
         toUnixTimestamp64Milli(max(timestamp)) AS last_ms,
         countIf(${since('fromMs')}) AS requests,
         countIf(${since('fromMs')} AND is_error = 1) AS errors,
         quantileIf(0.95)(duration_ms, ${since('fromMs')}) AS p95
       FROM spans
       WHERE ${SCOPE_FILTER}
         AND is_entry = 1
         AND service != ''
         ${optional(window.service, 'service = {service:String}')}
         AND ${since('lookbackFromMs')}
         AND resource_attributes['service.version'] != ''
       GROUP BY service, version
       ORDER BY service, first_ms`,
      { ...scope, ...window },
    );
    return rows.map((row) => ({
      service: row.service,
      version: row.version,
      firstSeenAt: Number(row.first_ms),
      lastSeenAt: Number(row.last_ms),
      requests: Number(row.requests),
      errors: Number(row.errors),
      p95Ms: toMs(row.p95),
    }));
  }

  /**
   * Database client spans (those with `db.system.name`) grouped by service,
   * system and normalised statement (`db.query.text`, or the older
   * `db.statement`, else the span name).
   */
  async slowQueries(scope: Scope, filters: DbQueryFilters): Promise<DbQuerySummary[]> {
    const rows = await this.query<{
      service: string;
      db_system: string;
      statement: string;
      collection: string;
      calls: Num;
      errors: Num;
      total_ms: NullableNum;
      avg_ms: NullableNum;
      p95: NullableNum;
      max_ms: NullableNum;
      slowest_trace_id: string;
      slowest_span_id: string;
    }>(
      `SELECT
         service,
         db_system,
         statement,
         any(collection) AS collection,
         count() AS calls,
         sum(is_error) AS errors,
         sum(duration_ms) AS total_ms,
         avg(duration_ms) AS avg_ms,
         quantile(0.95)(duration_ms) AS p95,
         max(duration_ms) AS max_ms,
         argMax(trace_id, duration_ms) AS slowest_trace_id,
         argMax(span_id, duration_ms) AS slowest_span_id
       FROM (
         SELECT service, db_system, trace_id, span_id, duration_ms, is_error,
                if(attributes['db.collection.name'] != '', attributes['db.collection.name'], attributes['db.sql.table']) AS collection,
                substring(trimBoth(replaceRegexpAll(replaceRegexpAll(replaceRegexpAll(
                  multiIf(attributes['db.query.text'] != '', attributes['db.query.text'],
                          attributes['db.statement'] != '', attributes['db.statement'],
                          name),
                  {stringLiteral:String}, '?'),
                  {numberLiteral:String}, {numberReplacement:String}),
                  {whitespace:String}, ' ')), 1, 2000) AS statement
         FROM spans
         WHERE ${SCOPE_FILTER}
           AND db_system != ''
           ${optional(filters.service, 'service = {service:String}')}
           AND ${since('fromMs')}
           ${optional(filters.toMs, before('toMs'))}
       )
       GROUP BY service, db_system, statement
       ORDER BY ${QUERY_ORDER[filters.sort]}
       LIMIT {limit:UInt32}`,
      { ...scope, ...filters, ...STATEMENT_PATTERNS },
    );
    return rows.map((row) => {
      const calls = Number(row.calls);
      const errors = Number(row.errors);
      return {
        service: row.service,
        dbSystem: row.db_system,
        statement: row.statement,
        collection: row.collection,
        calls,
        errors,
        errorRate: calls > 0 ? errors / calls : null,
        totalMs: toMs(row.total_ms) ?? 0,
        avgMs: toMs(row.avg_ms),
        p95Ms: toMs(row.p95),
        maxMs: toMs(row.max_ms),
        slowestTraceId: row.slowest_trace_id,
        slowestSpanId: row.slowest_span_id,
      };
    });
  }

  /** Entry spans of one endpoint counted in logarithmic duration bins. */
  async latencyHistogram(
    scope: Scope,
    filters: { fromMs: number; service: string; endpoint: string },
  ): Promise<RawLatencyBin[]> {
    const rows = await this.query<{ bin: Num; requests: Num; errors: Num }>(
      `SELECT
         if(duration_ms < 1, -1, toInt32(floor(log2(duration_ms) * {perDoubling:UInt8}))) AS bin,
         count() AS requests,
         sum(is_error) AS errors
       FROM spans
       WHERE ${SCOPE_FILTER}
         AND is_entry = 1
         AND service = {service:String}
         AND endpoint = {endpoint:String}
         AND ${since('fromMs')}
       GROUP BY bin
       ORDER BY bin`,
      { ...scope, ...filters, perDoubling: LATENCY_BINS_PER_DOUBLING },
    );
    return rows.map((row) => ({ bin: Number(row.bin), requests: Number(row.requests), errors: Number(row.errors) }));
  }

  async trace(scope: Scope, traceId: string, bounds: { fromMs: number; toMs?: number }): Promise<RawSpan[]> {
    const rows = await this.query<{
      span_id: string;
      parent_span_id: string;
      service: string;
      host: string;
      name: string;
      kind: SpanKind;
      ts_us: Num;
      duration_ms: number;
      status_code: SpanStatus;
      status_message: string;
      http_method: string;
      http_route: string;
      http_status: number;
      db_system: string;
      attributes: Record<string, string>;
      resource_attributes: Record<string, string>;
      events: string;
    }>(
      `SELECT span_id, parent_span_id, service, host, name, kind, toUnixTimestamp64Micro(timestamp) AS ts_us,
              duration_ms, status_code, status_message, http_method, http_route, http_status, db_system,
              attributes, resource_attributes, events
       FROM spans
       WHERE ${SCOPE_FILTER}
         AND trace_id = {traceId:String}
         AND ${since('fromMs')}
         ${optional(bounds.toMs, before('toMs'))}
       ORDER BY timestamp
       LIMIT 5000`,
      { ...scope, traceId, ...bounds },
    );
    return rows.map((row) => ({
      spanId: row.span_id,
      parentSpanId: row.parent_span_id,
      service: row.service,
      host: row.host,
      name: row.name,
      kind: row.kind,
      startMs: Number(row.ts_us) / 1000,
      durationMs: toMs(row.duration_ms) ?? 0,
      status: row.status_code,
      statusMessage: row.status_message,
      httpMethod: row.http_method,
      httpRoute: row.http_route,
      httpStatus: row.http_status || null,
      dbSystem: row.db_system,
      attributes: row.attributes,
      resourceAttributes: row.resource_attributes,
      events: parseEvents(row.events),
    }));
  }
}

function parseEvents(json: string): SpanEvent[] {
  try {
    const events = JSON.parse(json) as unknown;
    return Array.isArray(events) ? (events as SpanEvent[]) : [];
  } catch {
    return [];
  }
}
