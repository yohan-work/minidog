import type { MetricAggregation, MetricCatalogEntry } from '@minidog/types';
import { ClickHouseRepository } from '../db/clickhouse-repository';
import type { MetricRow } from '../ingest/otlp-metrics';
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

export class MetricRepository extends ClickHouseRepository {
  async insert(rows: readonly MetricRow[]): Promise<void> {
    await this.insertRows('metrics', rows);
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

  async utilizationSeries(
    scope: Scope,
    host: string,
    fromMs: number,
    stepSeconds: number,
  ): Promise<RawUtilizationPoint[]> {
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

  /** Metrics with data since `fromMs`, with the dimensions they can be filtered and grouped by. */
  async catalog(scope: Scope, fromMs: number): Promise<MetricCatalogEntry[]> {
    const rows = await this.query<{
      name: string;
      unit: string;
      type: 'gauge' | 'sum';
      temporality: MetricCatalogEntry['temporality'];
      services: string[];
      hosts: string[];
      attribute_keys: string[];
    }>(
      `SELECT
         metric_name AS name,
         any(unit) AS unit,
         any(metric_type) AS type,
         any(temporality) AS temporality,
         groupUniqArrayIf(50)(service, service != '') AS services,
         groupUniqArrayIf(50)(host, host != '') AS hosts,
         groupUniqArrayArray(30)(mapKeys(attributes)) AS attribute_keys
       FROM metrics
       WHERE ${SCOPE_FILTER} AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})
       GROUP BY metric_name
       ORDER BY metric_name
       LIMIT 500`,
      { ...scope, fromMs },
    );
    return rows.map((row) => ({
      name: row.name,
      unit: row.unit,
      type: row.type,
      temporality: row.temporality,
      services: [...row.services].sort(),
      hosts: [...row.hosts].sort(),
      attributeKeys: [...row.attribute_keys].sort(),
    }));
  }

  /** One aggregated value per bucket and group. */
  async aggregate(
    scope: Scope,
    query: MetricAggregateQuery,
  ): Promise<{ t: number; group: string; value: number | null }[]> {
    const rows = await this.query<{ t: Num; grp: string; value: NullableNum }>(
      `SELECT
         intDiv(toUnixTimestamp(timestamp), {step:UInt32}) * {step:UInt32} AS t,
         ${GROUP_EXPRESSIONS[groupKind(query.groupBy)]} AS grp,
         ${AGGREGATIONS[query.aggregation]} AS value
       FROM metrics
       WHERE ${SCOPE_FILTER}
         AND metric_name = {metric:String}
         ${query.service === undefined ? '' : 'AND service = {service:String}'}
         ${query.host === undefined ? '' : 'AND host = {host:String}'}
         AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})
       GROUP BY t, grp
       ORDER BY t`,
      {
        ...scope,
        ...query,
        groupKey: query.groupBy?.startsWith('attr:') ? query.groupBy.slice(5) : '',
        step: query.stepSeconds,
      },
    );
    return rows.map((row) => {
      const value = row.value === null ? null : Number(row.value);
      return { t: Number(row.t), group: row.grp, value: value !== null && Number.isFinite(value) ? value : null };
    });
  }
}

export interface MetricAggregateQuery {
  metric: string;
  aggregation: MetricAggregation;
  fromMs: number;
  stepSeconds: number;
  service?: string;
  host?: string;
  /** `service`, `host` or `attr:<key>`; undefined for a single series. */
  groupBy?: string;
}

const AGGREGATIONS: Record<MetricAggregation, string> = {
  avg: 'avg(value)',
  min: 'min(value)',
  max: 'max(value)',
  sum: 'sum(value)',
  p95: 'quantile(0.95)(value)',
  // Delta sums: total per bucket spread over the bucket.
  rate: 'sum(value) / {step:UInt32}',
};

const GROUP_EXPRESSIONS = {
  none: `''`,
  service: 'service',
  host: 'host',
  attribute: 'attributes[{groupKey:String}]',
} as const;

function groupKind(groupBy: string | undefined): keyof typeof GROUP_EXPRESSIONS {
  if (groupBy === 'service' || groupBy === 'host') return groupBy;
  return groupBy?.startsWith('attr:') ? 'attribute' : 'none';
}
