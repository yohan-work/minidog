import type { CheckResult, CheckStatus, SeriesPoint } from '@minidog/types';
import { ClickHouseRepository } from '../db/clickhouse-repository';
import type { Scope } from './project-repository';

/** Row shape of `synthetic_results` as written with JSONEachRow. */
export interface SyntheticResultRow {
  timestamp: string;
  project_id: string;
  environment: string;
  monitor_id: string;
  url: string;
  status: CheckStatus;
  status_code: number;
  latency_ms: number;
  dns_ms: number | null;
  connect_ms: number | null;
  tls_ms: number | null;
  ttfb_ms: number | null;
  ssl_expiry: string | null;
  error: string;
  redirects: number;
  final_url: string;
}

export interface RawMonitorSummary {
  lastCheckedAt: number;
  lastStatus: CheckStatus;
  lastStatusCode: number;
  lastLatencyMs: number;
  lastError: string;
  sslExpiresAt: number | null;
  checks: number;
  failures: number;
  p95LatencyMs: number | null;
  avgLatencyMs: number | null;
  /** Newest first, at most 5, from the last 24 hours. */
  recentStatuses: CheckStatus[];
}

export interface Totals {
  checks: number;
  failures: number;
  p95LatencyMs: number | null;
  avgLatencyMs: number | null;
}

// ClickHouse serialises 64-bit integers as strings and NaN as null.
type Num = number | string;
type NullableNum = Num | null;

const toNumber = (value: Num): number => Number(value);
const toLatency = (value: NullableNum): number | null =>
  value === null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 10) / 10;

/** `2026-09-14 12:00:00.123` in UTC, as expected by DateTime64(3, 'UTC'). */
export function toDateTime64(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/** `2026-09-14 12:00:00` in UTC, as expected by DateTime('UTC'). */
export function toDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

const SCOPE_FILTER = `
  project_id = {projectId:String}
  AND environment = {environment:String}
  AND monitor_id IN {monitorIds:Array(String)}`;

export class SyntheticResultRepository extends ClickHouseRepository {
  async insert(rows: readonly SyntheticResultRow[]): Promise<void> {
    await this.insertRows('synthetic_results', rows);
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result.success;
    } catch {
      return false;
    }
  }

  async summaries(
    scope: Scope,
    monitorIds: readonly string[],
    fromMs: number,
  ): Promise<Map<string, RawMonitorSummary>> {
    if (monitorIds.length === 0) return new Map();

    const rows = await this.query<{
      monitor_id: string;
      last_ts: Num;
      last_status: CheckStatus;
      last_status_code: number;
      last_latency_ms: number;
      last_error: string;
      ssl_expiry_ts: NullableNum;
      checks: Num;
      failures: Num;
      p95_latency_ms: NullableNum;
      avg_latency_ms: NullableNum;
      recent_statuses: CheckStatus[];
    }>(
      `SELECT
         monitor_id,
         toUnixTimestamp64Milli(max(timestamp)) AS last_ts,
         argMax(status, timestamp) AS last_status,
         argMax(status_code, timestamp) AS last_status_code,
         argMax(latency_ms, timestamp) AS last_latency_ms,
         argMax(error, timestamp) AS last_error,
         toUnixTimestamp(argMax(ssl_expiry, timestamp)) AS ssl_expiry_ts,
         countIf(timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})) AS checks,
         countIf(timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND status = 'down') AS failures,
         quantileIf(0.95)(latency_ms, timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND status = 'up') AS p95_latency_ms,
         avgIf(latency_ms, timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND status = 'up') AS avg_latency_ms,
         arrayMap(x -> x.2, arraySlice(
           arrayReverseSort(x -> x.1, groupArrayIf((timestamp, status), timestamp >= now64(3) - INTERVAL 1 DAY)),
           1, 5)) AS recent_statuses
       FROM synthetic_results
       WHERE ${SCOPE_FILTER}
         AND timestamp >= now64(3) - INTERVAL 7 DAY
       GROUP BY monitor_id`,
      { ...scope, monitorIds, fromMs },
    );

    return new Map(
      rows.map((row) => [
        row.monitor_id,
        {
          lastCheckedAt: toNumber(row.last_ts),
          lastStatus: row.last_status,
          lastStatusCode: row.last_status_code,
          lastLatencyMs: toLatency(row.last_latency_ms) ?? 0,
          lastError: row.last_error,
          sslExpiresAt: row.ssl_expiry_ts === null ? null : toNumber(row.ssl_expiry_ts) * 1000,
          checks: toNumber(row.checks),
          failures: toNumber(row.failures),
          p95LatencyMs: toLatency(row.p95_latency_ms),
          avgLatencyMs: toLatency(row.avg_latency_ms),
          recentStatuses: row.recent_statuses,
        },
      ]),
    );
  }

  async series(
    scope: Scope,
    monitorIds: readonly string[],
    fromMs: number,
    stepSeconds: number,
  ): Promise<SeriesPoint[]> {
    if (monitorIds.length === 0) return [];

    const rows = await this.query<{
      t: Num;
      checks: Num;
      failures: Num;
      avg_latency_ms: NullableNum;
      p95_latency_ms: NullableNum;
    }>(
      `SELECT
         intDiv(toUnixTimestamp(timestamp), {step:UInt32}) * {step:UInt32} AS t,
         count() AS checks,
         countIf(status = 'down') AS failures,
         avgIf(latency_ms, status = 'up') AS avg_latency_ms,
         quantileIf(0.95)(latency_ms, status = 'up') AS p95_latency_ms
       FROM synthetic_results
       WHERE ${SCOPE_FILTER}
         AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})
       GROUP BY t
       ORDER BY t`,
      { ...scope, monitorIds, fromMs, step: stepSeconds },
    );

    return rows.map((row) => ({
      t: toNumber(row.t),
      checks: toNumber(row.checks),
      failures: toNumber(row.failures),
      avgLatencyMs: toLatency(row.avg_latency_ms),
      p95LatencyMs: toLatency(row.p95_latency_ms),
    }));
  }

  async totals(scope: Scope, monitorIds: readonly string[], fromMs: number): Promise<Totals> {
    if (monitorIds.length === 0) return { checks: 0, failures: 0, p95LatencyMs: null, avgLatencyMs: null };

    const [row] = await this.query<{
      checks: Num;
      failures: Num;
      p95_latency_ms: NullableNum;
      avg_latency_ms: NullableNum;
    }>(
      `SELECT
         count() AS checks,
         countIf(status = 'down') AS failures,
         quantileIf(0.95)(latency_ms, status = 'up') AS p95_latency_ms,
         avgIf(latency_ms, status = 'up') AS avg_latency_ms
       FROM synthetic_results
       WHERE ${SCOPE_FILTER}
         AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})`,
      { ...scope, monitorIds, fromMs },
    );

    return {
      checks: row ? toNumber(row.checks) : 0,
      failures: row ? toNumber(row.failures) : 0,
      p95LatencyMs: row ? toLatency(row.p95_latency_ms) : null,
      avgLatencyMs: row ? toLatency(row.avg_latency_ms) : null,
    };
  }

  async recentChecks(scope: Scope, monitorId: string, limit: number): Promise<CheckResult[]> {
    const rows = await this.query<{
      ts: Num;
      status: CheckStatus;
      status_code: number;
      latency_ms: number;
      dns_ms: NullableNum;
      connect_ms: NullableNum;
      tls_ms: NullableNum;
      ttfb_ms: NullableNum;
      ssl_expiry_ts: NullableNum;
      error: string;
      redirects: number;
      final_url: string;
    }>(
      `SELECT
         toUnixTimestamp64Milli(timestamp) AS ts,
         status, status_code, latency_ms, dns_ms, connect_ms, tls_ms, ttfb_ms,
         toUnixTimestamp(ssl_expiry) AS ssl_expiry_ts,
         error, redirects, final_url
       FROM synthetic_results
       WHERE ${SCOPE_FILTER}
         AND timestamp >= now64(3) - INTERVAL 7 DAY
       ORDER BY timestamp DESC
       LIMIT {limit:UInt32}`,
      { ...scope, monitorIds: [monitorId], limit },
    );

    return rows.map((row) => ({
      timestamp: toNumber(row.ts),
      status: row.status,
      statusCode: row.status_code,
      latencyMs: toLatency(row.latency_ms) ?? 0,
      dnsMs: toLatency(row.dns_ms),
      connectMs: toLatency(row.connect_ms),
      tlsMs: toLatency(row.tls_ms),
      ttfbMs: toLatency(row.ttfb_ms),
      sslExpiresAt: row.ssl_expiry_ts === null ? null : toNumber(row.ssl_expiry_ts) * 1000,
      error: row.error,
      redirects: Number(row.redirects),
      finalUrl: row.final_url,
    }));
  }
}
