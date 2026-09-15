import type { RetentionSignal } from '@minidog/types';
import { ClickHouseRepository } from '../db/clickhouse-repository';

type Num = number | string;

/** One ClickHouse table per signal, shared by every project. */
export const SIGNAL_TABLES: Record<RetentionSignal, string> = {
  traces: 'spans',
  logs: 'logs',
  metrics: 'metrics',
  synthetics: 'synthetic_results',
};
const TABLES = Object.values(SIGNAL_TABLES);

/** Days in a table's TTL; ClickHouse prints `INTERVAL N DAY` as `toIntervalDay(N)`. */
export function parseRetentionDays(createTableQuery: string): number | null {
  const match = /\bTTL\b.*?(?:toIntervalDay\((\d+)\)|INTERVAL (\d+) DAY)/is.exec(createTableQuery);
  return match ? Number(match[1] ?? match[2]) : null;
}

export class StorageRepository extends ClickHouseRepository {
  /** Rows and compressed bytes per table, from the active data parts. */
  async usage(): Promise<Map<string, { rows: number; bytes: number }>> {
    const rows = await this.query<{ table: string; rows: Num; bytes: Num }>(
      `SELECT table, sum(rows) AS rows, sum(bytes_on_disk) AS bytes
       FROM system.parts
       WHERE database = currentDatabase() AND active AND table IN {tables:Array(String)}
       GROUP BY table`,
      { tables: TABLES },
    );
    return new Map(rows.map((row) => [row.table, { rows: Number(row.rows), bytes: Number(row.bytes) }]));
  }

  /** Epoch ms of each table's oldest record; null when it is empty. */
  async oldest(): Promise<Map<string, number | null>> {
    // Table names come from SIGNAL_TABLES, never from a request.
    const rows = await this.query<{ table: string; oldest: Num }>(
      TABLES.map((table) => `SELECT '${table}' AS table, toUnixTimestamp(min(timestamp)) AS oldest FROM ${table}`).join('\nUNION ALL\n'),
      {},
    );
    return new Map(rows.map((row) => [row.table, Number(row.oldest) > 0 ? Number(row.oldest) * 1000 : null]));
  }

  async retention(): Promise<Map<string, number | null>> {
    const rows = await this.query<{ name: string; create_table_query: string }>(
      `SELECT name, create_table_query FROM system.tables WHERE database = currentDatabase() AND name IN {tables:Array(String)}`,
      { tables: TABLES },
    );
    return new Map(rows.map((row) => [row.name, parseRetentionDays(row.create_table_query)]));
  }

  /** Records older than `days` are removed right away; the TTL keeps removing them afterwards. */
  async setRetention(signal: RetentionSignal, days: number): Promise<void> {
    // The table comes from a fixed map and days are validated against RETENTION_DAYS.
    const query = `ALTER TABLE ${SIGNAL_TABLES[signal]} MODIFY TTL toDateTime(timestamp) + INTERVAL ${Math.trunc(days)} DAY`;
    await this.run(() => this.client.command({ query }));
  }
}
