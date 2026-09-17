import {
  LOG_FACET_KEYS,
  LOG_FACET_VALUES,
  LOG_LEVELS,
  type LogEntry,
  type LogFacet,
  type LogLevel,
  type LogVolumePoint,
} from '@minidog/types';
import { ClickHouseRepository } from '../db/clickhouse-repository';
import type { LogRow } from '../ingest/otlp-logs';
import type { Scope } from './project-repository';

type Num = number | string;

const SCOPE_FILTER = `project_id = {projectId:String} AND environment = {environment:String}`;
const LEVEL_ORDER = `[${LOG_LEVELS.map((level) => `'${level}'`).join(', ')}]`;

export interface LogFilters {
  fromMs: number;
  /** Exclusive upper bound; open-ended when absent. */
  toMs?: number;
  service?: string;
  /** Records at this level or more severe. */
  minLevel?: LogLevel;
  /** Case-insensitive text in the body. */
  query?: string;
  traceId?: string;
  /** Records whose attributes carry every one of these values. */
  attributes?: readonly { key: string; value: string }[];
  limit: number;
}

function filterSql(filters: Omit<LogFilters, 'limit'>): string {
  return [
    filters.service === undefined ? '' : 'AND service = {service:String}',
    filters.minLevel === undefined ? '' : `AND indexOf(${LEVEL_ORDER}, level) >= {minRank:UInt8}`,
    filters.query === undefined ? '' : 'AND positionCaseInsensitive(body, {query:String}) > 0',
    filters.traceId === undefined ? '' : 'AND trace_id = {traceId:String}',
    // A missing key reads as '' from a Map, so a filter on an empty value must also ask for the key.
    ...(filters.attributes ?? []).map(
      (_, index) =>
        `AND mapContains(attributes, {attrKey${index}:String}) AND attributes[{attrKey${index}:String}] = {attrValue${index}:String}`,
    ),
    'AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})',
    filters.toMs === undefined ? '' : 'AND timestamp < fromUnixTimestamp64Milli({toMs:Int64})',
  ].join('\n');
}

function filterParams(scope: Scope, filters: Omit<LogFilters, 'limit'>) {
  const { attributes, ...rest } = filters;
  return {
    ...scope,
    ...rest,
    minRank: filters.minLevel === undefined ? 0 : LOG_LEVELS.indexOf(filters.minLevel) + 1,
    ...Object.fromEntries(
      (attributes ?? []).flatMap(({ key, value }, index) => [
        [`attrKey${index}`, key],
        [`attrValue${index}`, value],
      ]),
    ),
  };
}

export class LogRepository extends ClickHouseRepository {
  async insert(rows: readonly LogRow[]): Promise<void> {
    await this.insertRows('logs', rows);
  }

  async countByTrace(scope: Scope, traceId: string, bounds: { fromMs: number; toMs?: number }): Promise<number> {
    const [row] = await this.query<{ count: Num }>(
      `SELECT count() AS count FROM logs
       WHERE ${SCOPE_FILTER}
         ${filterSql({ traceId, ...bounds })}`,
      filterParams(scope, { traceId, ...bounds }),
    );
    return Number(row?.count ?? 0);
  }

  /** Newest first. */
  async search(scope: Scope, filters: LogFilters): Promise<LogEntry[]> {
    const rows = await this.query<{
      ts_us: Num;
      service: string;
      host: string;
      level: LogLevel;
      severity_text: string;
      body: string;
      trace_id: string;
      span_id: string;
      attributes: Record<string, string>;
    }>(
      `SELECT toUnixTimestamp64Micro(timestamp) AS ts_us, service, host, level, severity_text, body, trace_id, span_id, attributes
       FROM logs
       WHERE ${SCOPE_FILTER}
         ${filterSql(filters)}
       ORDER BY timestamp DESC
       LIMIT {limit:UInt32}`,
      filterParams(scope, filters),
    );
    return rows.map((row) => ({
      timestamp: Number(row.ts_us) / 1000,
      service: row.service,
      host: row.host,
      level: row.level,
      severityText: row.severity_text,
      body: row.body,
      traceId: row.trace_id,
      spanId: row.span_id,
      attributes: row.attributes,
    }));
  }

  async volume(scope: Scope, filters: Omit<LogFilters, 'limit'>, stepSeconds: number): Promise<LogVolumePoint[]> {
    const rows = await this.query<{ t: Num; total: Num; errors: Num }>(
      `SELECT
         intDiv(toUnixTimestamp(timestamp), {step:UInt32}) * {step:UInt32} AS t,
         count() AS total,
         countIf(level IN ('error', 'fatal')) AS errors
       FROM logs
       WHERE ${SCOPE_FILTER}
         ${filterSql(filters)}
       GROUP BY t
       ORDER BY t`,
      { ...filterParams(scope, filters), step: stepSeconds },
    );
    return rows.map((row) => ({ t: Number(row.t), total: Number(row.total), errors: Number(row.errors) }));
  }

  /**
   * The attribute keys of the matching records, commonest first, each with
   * its commonest values. Two passes over the window: keys, then the values
   * of those keys, so a key with many distinct values cannot crowd out the
   * others.
   */
  async facets(scope: Scope, filters: Omit<LogFilters, 'limit'>): Promise<LogFacet[]> {
    const params = filterParams(scope, filters);
    const keys = await this.query<{ key: string; count: Num }>(
      `SELECT key, count() AS count
       FROM logs
       ARRAY JOIN mapKeys(attributes) AS key
       WHERE ${SCOPE_FILTER}
         ${filterSql(filters)}
       GROUP BY key
       ORDER BY count DESC, key
       LIMIT {keyLimit:UInt32}`,
      { ...params, keyLimit: LOG_FACET_KEYS },
    );
    if (keys.length === 0) return [];

    const values = await this.query<{ key: string; value: string; count: Num }>(
      `SELECT key, value, count() AS count
       FROM logs
       ARRAY JOIN mapKeys(attributes) AS key, mapValues(attributes) AS value
       WHERE ${SCOPE_FILTER}
         ${filterSql(filters)}
         AND key IN {keys:Array(String)}
       GROUP BY key, value
       ORDER BY count DESC, value
       LIMIT {valueLimit:UInt32} BY key`,
      { ...params, keys: keys.map((row) => row.key), valueLimit: LOG_FACET_VALUES },
    );

    return keys.map((row) => ({
      key: row.key,
      count: Number(row.count),
      values: values
        .filter((value) => value.key === row.key)
        .map((value) => ({ value: value.value, count: Number(value.count) })),
    }));
  }

  async services(scope: Scope, fromMs: number): Promise<string[]> {
    const rows = await this.query<{ service: string }>(
      `SELECT DISTINCT service FROM logs
       WHERE ${SCOPE_FILTER} AND service != '' AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})
       ORDER BY service
       LIMIT 500`,
      { ...scope, fromMs },
    );
    return rows.map((row) => row.service);
  }
}
