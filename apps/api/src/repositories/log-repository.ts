import { LOG_LEVELS, type LogEntry, type LogLevel, type LogVolumePoint } from '@minidog/types';
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
  limit: number;
}

function filterSql(filters: Omit<LogFilters, 'limit'>): string {
  return [
    filters.service === undefined ? '' : 'AND service = {service:String}',
    filters.minLevel === undefined ? '' : `AND indexOf(${LEVEL_ORDER}, level) >= {minRank:UInt8}`,
    filters.query === undefined ? '' : 'AND positionCaseInsensitive(body, {query:String}) > 0',
    filters.traceId === undefined ? '' : 'AND trace_id = {traceId:String}',
    'AND timestamp >= fromUnixTimestamp64Milli({fromMs:Int64})',
    filters.toMs === undefined ? '' : 'AND timestamp < fromUnixTimestamp64Milli({toMs:Int64})',
  ].join('\n');
}

function filterParams(scope: Scope, filters: Omit<LogFilters, 'limit'>) {
  return {
    ...scope,
    ...filters,
    minRank: filters.minLevel === undefined ? 0 : LOG_LEVELS.indexOf(filters.minLevel) + 1,
  };
}

export class LogRepository extends ClickHouseRepository {
  async insert(rows: readonly LogRow[]): Promise<void> {
    await this.insertRows('logs', rows);
  }

  async countByTrace(scope: Scope, traceId: string): Promise<number> {
    const [row] = await this.query<{ count: Num }>(
      `SELECT count() AS count FROM logs WHERE ${SCOPE_FILTER} AND trace_id = {traceId:String}`,
      { ...scope, traceId },
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
