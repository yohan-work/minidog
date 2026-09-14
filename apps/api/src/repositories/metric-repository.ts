import { ClickHouseError, type ClickHouseClient } from '@clickhouse/client';
import type { MetricRow } from '../ingest/otlp-metrics';
import { ClickHouseUnavailableError } from '../lib/errors';
import type { Scope } from './project-repository';

export interface RawHost {
  host: string;
  /** Epoch milliseconds. */
  lastSeenAt: number;
  os: string | null;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  diskMountpoint: string | null;
}

export interface NetworkRate {
  rxBps: number | null;
  txBps: number | null;
}

export interface RawUtilizationPoint {
  t: number;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
}

export interface RawNetworkPoint extends NetworkRate {
  t: number;
}

// ClickHouse serialises 64-bit integers as strings.
type Num = number | string;
type NullableNum = Num | null;

const toRatio = (value: NullableNum): number | null => {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10_000) / 10_000 : null;
};

const toRate = (value: NullableNum): number | null => {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
};

const SCOPE_FILTER = `project_id = {projectId:String} AND environment = {environment:String}`;
const hostFilter = (host: string | undefined) => (host === undefined ? `host != ''` : `host = {host:String}`);
const hostParam = (host: string | undefined) => (host === undefined ? {} : { host });

// hostmetrics receiver metric names (utilization metrics must be enabled).
const CPU_IDLE = `metric_name = 'system.cpu.utilization' AND attributes['state'] = 'idle'`;
const MEMORY_USED = `metric_name = 'system.memory.utilization' AND attributes['state'] = 'used'`;
const FILESYSTEM = `metric_name = 'system.filesystem.utilization'`;
const NETWORK_DELTAS = `metric_name = 'system.network.io' AND temporality = 'delta'`;

/**
 * Bytes per second from per-scrape byte deltas (`bytes` at time `ts`, ms).
 * A delta covers the interval before its scrape, so the first scrape of the
 * span is left out and the sum is divided by the time from first to last.
 */
const RATE_FROM_DELTAS = `if(count() > 1, (sum(bytes) - argMin(bytes, ts)) / ((max(ts) - min(ts)) / 1000), NULL)`;

export class MetricRepository {
  constructor(private readonly client: ClickHouseClient) {}

  async insert(rows: readonly MetricRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.run(() => this.client.insert({ table: 'metrics', values: rows, format: 'JSONEachRow' }));
  }

  /** Hosts with any data since `seenFromMs`; utilization is averaged since `currentFromMs`. */
  async hosts(scope: Scope, seenFromMs: number, currentFromMs: number, host?: string): Promise<RawHost[]> {
    const current = `timestamp >= fromUnixTimestamp64Milli({currentFromMs:Int64})`;
    const rows = await this.query<{
      host: string;
      last_ts: Num;
      os_type: string;
      cpu: NullableNum;
      memory: NullableNum;
      disk: NullableNum;
      disk_mountpoint: string;
    }>(
      `SELECT
         host,
         toUnixTimestamp64Milli(max(timestamp)) AS last_ts,
         anyIf(resource_attributes['os.type'], resource_attributes['os.type'] != '') AS os_type,
         1 - avgOrNullIf(value, ${CPU_IDLE} AND ${current}) AS cpu,
         avgOrNullIf(value, ${MEMORY_USED} AND ${current}) AS memory,
         maxOrNullIf(value, ${FILESYSTEM} AND ${current}) AS disk,
         argMaxIf(attributes['mountpoint'], value, ${FILESYSTEM} AND ${current}) AS disk_mountpoint
       FROM metrics
       WHERE ${SCOPE_FILTER}
         AND ${hostFilter(host)}
         AND timestamp >= fromUnixTimestamp64Milli({seenFromMs:Int64})
       GROUP BY host
       ORDER BY host`,
      { ...scope, seenFromMs, currentFromMs, ...hostParam(host) },
    );

    return rows.map((row) => ({
      host: row.host,
      lastSeenAt: Number(row.last_ts),
      os: row.os_type || null,
      cpu: toRatio(row.cpu),
      memory: toRatio(row.memory),
      disk: toRatio(row.disk),
      diskMountpoint: row.disk_mountpoint || null,
    }));
  }

  /** Network throughput per host since `fromMs`. */
  async networkRates(scope: Scope, fromMs: number, host?: string): Promise<Map<string, NetworkRate>> {
    const rows = await this.query<{ host: string; direction: string; rate: NullableNum }>(
      `SELECT host, direction, ${RATE_FROM_DELTAS} AS rate
       FROM (
         SELECT host, attributes['direction'] AS direction, toUnixTimestamp64Milli(timestamp) AS ts, sum(value) AS bytes
         FROM metrics
         WHERE ${SCOPE_FILTER}
           AND ${hostFilter(host)}
           AND ${NETWORK_DELTAS}
           AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})
         GROUP BY host, direction, ts
       )
       GROUP BY host, direction`,
      { ...scope, fromMs, ...hostParam(host) },
    );

    const rates = new Map<string, NetworkRate>();
    for (const row of rows) {
      const rate = rates.get(row.host) ?? { rxBps: null, txBps: null };
      if (row.direction === 'receive') rate.rxBps = toRate(row.rate);
      else if (row.direction === 'transmit') rate.txBps = toRate(row.rate);
      rates.set(row.host, rate);
    }
    return rates;
  }

  async utilizationSeries(scope: Scope, host: string, fromMs: number, stepSeconds: number): Promise<RawUtilizationPoint[]> {
    const rows = await this.query<{ t: Num; cpu: NullableNum; memory: NullableNum; disk: NullableNum }>(
      `SELECT
         intDiv(toUnixTimestamp(timestamp), {step:UInt32}) * {step:UInt32} AS t,
         1 - avgOrNullIf(value, ${CPU_IDLE}) AS cpu,
         avgOrNullIf(value, ${MEMORY_USED}) AS memory,
         maxOrNullIf(value, ${FILESYSTEM}) AS disk
       FROM metrics
       WHERE ${SCOPE_FILTER}
         AND host = {host:String}
         AND metric_name IN ('system.cpu.utilization', 'system.memory.utilization', 'system.filesystem.utilization')
         AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})
       GROUP BY t
       ORDER BY t`,
      { ...scope, host, fromMs, step: stepSeconds },
    );

    return rows.map((row) => ({
      t: Number(row.t),
      cpu: toRatio(row.cpu),
      memory: toRatio(row.memory),
      disk: toRatio(row.disk),
    }));
  }

  async networkSeries(scope: Scope, host: string, fromMs: number, stepSeconds: number): Promise<RawNetworkPoint[]> {
    const rows = await this.query<{ t: Num; direction: string; rate: NullableNum }>(
      `SELECT t, direction, ${RATE_FROM_DELTAS} AS rate
       FROM (
         SELECT
           intDiv(toUnixTimestamp(timestamp), {step:UInt32}) * {step:UInt32} AS t,
           attributes['direction'] AS direction,
           toUnixTimestamp64Milli(timestamp) AS ts,
           sum(value) AS bytes
         FROM metrics
         WHERE ${SCOPE_FILTER}
           AND host = {host:String}
           AND ${NETWORK_DELTAS}
           AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})
         GROUP BY t, direction, ts
       )
       GROUP BY t, direction
       ORDER BY t`,
      { ...scope, host, fromMs, step: stepSeconds },
    );

    const points = new Map<number, RawNetworkPoint>();
    for (const row of rows) {
      const t = Number(row.t);
      const point = points.get(t) ?? { t, rxBps: null, txBps: null };
      if (row.direction === 'receive') point.rxBps = toRate(row.rate);
      else if (row.direction === 'transmit') point.txBps = toRate(row.rate);
      points.set(t, point);
    }
    return [...points.values()];
  }

  private async query<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
    return this.run(async () => {
      const result = await this.client.query({ query, query_params: params, format: 'JSONEachRow' });
      return result.json<T>();
    });
  }

  /** Server-side query errors are bugs (500); anything else means ClickHouse is unreachable (503). */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ClickHouseError) throw error;
      throw new ClickHouseUnavailableError(error);
    }
  }
}
