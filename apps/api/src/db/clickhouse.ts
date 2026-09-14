import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS synthetic_results
  (
    timestamp    DateTime64(3, 'UTC'),
    project_id   LowCardinality(String),
    environment  LowCardinality(String),
    monitor_id   String,
    url          String,
    status       Enum8('up' = 1, 'down' = 2),
    status_code  UInt16,
    latency_ms   Float64,
    dns_ms       Nullable(Float64),
    connect_ms   Nullable(Float64),
    tls_ms       Nullable(Float64),
    ttfb_ms      Nullable(Float64),
    ssl_expiry   Nullable(DateTime('UTC')),
    error        String
  )
  ENGINE = MergeTree
  PARTITION BY toYYYYMM(timestamp)
  ORDER BY (project_id, monitor_id, timestamp)
  TTL toDateTime(timestamp) + INTERVAL 90 DAY
  `,
  // OTLP gauge and sum data points, one row per point.
  `
  CREATE TABLE IF NOT EXISTS metrics
  (
    timestamp            DateTime64(3, 'UTC'),
    project_id           LowCardinality(String),
    environment          LowCardinality(String),
    service              LowCardinality(String),
    host                 LowCardinality(String),
    metric_name          LowCardinality(String),
    metric_type          LowCardinality(String),
    temporality          LowCardinality(String),
    unit                 LowCardinality(String),
    value                Float64,
    attributes           Map(LowCardinality(String), String),
    resource_attributes  Map(LowCardinality(String), String)
  )
  ENGINE = MergeTree
  PARTITION BY toDate(timestamp)
  ORDER BY (project_id, environment, host, metric_name, timestamp)
  TTL toDateTime(timestamp) + INTERVAL 30 DAY
  SETTINGS ttl_only_drop_parts = 1
  `,
];

export function createClickHouse(config: Config): ClickHouseClient {
  return createClient({
    url: config.CLICKHOUSE_URL,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
    database: config.CLICKHOUSE_DATABASE,
    request_timeout: 10_000,
    application: 'minidog-api',
  });
}

/**
 * Applies the schema, retrying until ClickHouse is reachable. The API stays up
 * in the meantime so metadata screens keep working.
 */
export async function ensureClickHouseSchema(
  client: ClickHouseClient,
  log: FastifyBaseLogger,
  signal: AbortSignal,
): Promise<void> {
  let attempt = 0;
  while (!signal.aborted) {
    try {
      for (const query of MIGRATIONS) await client.command({ query });
      if (attempt > 0) log.info('ClickHouse schema applied');
      return;
    } catch (error) {
      if (attempt === 0) log.warn({ err: error }, 'ClickHouse unavailable; retrying schema setup every 5s');
      attempt += 1;
      await sleep(5_000, undefined, { signal }).catch(() => undefined);
    }
  }
}
