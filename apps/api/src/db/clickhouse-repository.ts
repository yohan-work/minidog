import { ClickHouseError, type ClickHouseClient } from '@clickhouse/client';
import { ClickHouseUnavailableError } from '../lib/errors';

/**
 * Query helpers shared by telemetry repositories. Server-side query errors are
 * bugs (500); anything else means ClickHouse is unreachable (503).
 */
export abstract class ClickHouseRepository {
  constructor(protected readonly client: ClickHouseClient) {}

  protected async insertRows(table: string, rows: readonly object[]): Promise<void> {
    if (rows.length === 0) return;
    await this.run(() => this.client.insert({ table, values: [...rows], format: 'JSONEachRow' }));
  }

  protected async query<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
    return this.run(async () => {
      const result = await this.client.query({ query, query_params: params, format: 'JSONEachRow' });
      return result.json<T>();
    });
  }

  protected async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ClickHouseError) throw error;
      throw new ClickHouseUnavailableError(error);
    }
  }
}
