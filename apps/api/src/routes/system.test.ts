import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClickHouseClient } from '@clickhouse/client';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { openDatabase } from '../db/sqlite';

/** Only `ping` matters here; every other call fails as if ClickHouse were gone. */
const clickHouse = (reachable: boolean) =>
  ({
    ping: async () => ({ success: reachable }),
    command: async () => undefined,
    close: async () => undefined,
    query: async () => {
      throw new Error('offline');
    },
    insert: async () => undefined,
  }) as unknown as ClickHouseClient;

async function start(reachable: boolean) {
  const config = loadConfig({
    SQLITE_PATH: ':memory:',
    WORKER_ENABLED: 'false',
    ALERTS_ENABLED: 'false',
    LOG_LEVEL: 'silent',
  });
  return buildApp(config, { sqlite: openDatabase(':memory:'), clickhouse: clickHouse(reachable) });
}

test('health is ok when ClickHouse answers', async () => {
  const app = await start(true);
  try {
    const response = await app.inject({ url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok', sqlite: 'ok', clickhouse: 'ok' });
  } finally {
    await app.close();
  }
});

test('an unreachable ClickHouse is degraded, not down: the API still answers 200', async () => {
  const app = await start(false);
  try {
    const response = await app.inject({ url: '/api/health' });
    // A 503 here would fail the container healthcheck, and the dashboard and
    // collector both wait for the API to be healthy before they start.
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'degraded', sqlite: 'ok', clickhouse: 'unavailable' });
  } finally {
    await app.close();
  }
});
