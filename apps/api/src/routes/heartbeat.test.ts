import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClickHouseClient } from '@clickhouse/client';
import type { AlertMonitor } from '@minidog/types';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { openDatabase } from '../db/sqlite';
import { minutesSincePing } from '../worker/alert-evaluator';

const DASHBOARD = { 'x-minidog-request': '1', 'content-type': 'application/json' };

// Heartbeats need no telemetry; ClickHouse calls fail as if it were down.
const offlineClickHouse = {
  command: async () => undefined,
  close: async () => undefined,
  query: async () => {
    throw new Error('offline');
  },
  insert: async () => undefined,
} as unknown as ClickHouseClient;

async function start() {
  const config = loadConfig({
    SQLITE_PATH: ':memory:',
    WORKER_ENABLED: 'false',
    ALERTS_ENABLED: 'true',
    AUTH_DISABLED: 'true',
    LOG_LEVEL: 'silent',
  });
  return buildApp(config, { sqlite: openDatabase(':memory:'), clickhouse: offlineClickHouse });
}

test('a heartbeat monitor gets a token on creation and waits for the first ping', async () => {
  const app = await start();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/alerting/monitors',
      headers: DASHBOARD,
      payload: { type: 'heartbeat', criticalThreshold: 30 },
    });
    assert.equal(created.statusCode, 201);
    const { monitor } = created.json<{ monitor: AlertMonitor }>();
    assert.match(monitor.target, /^hb_[0-9a-z]{20}$/);
    assert.equal(monitor.name, 'Heartbeat');
    assert.deepEqual(monitor.heartbeat, { lastPingAt: null, pings: 0 });
    // Evaluated on creation: nothing has pinged yet.
    assert.equal(monitor.state, 'no_data');
    assert.equal(monitor.stateMessage, 'No ping received yet');

    // Other types still need a target.
    const noTarget = await app.inject({
      method: 'POST',
      url: '/api/alerting/monitors',
      headers: DASHBOARD,
      payload: { type: 'latency' },
    });
    assert.equal(noTarget.statusCode, 400);
    assert.equal(noTarget.json().error.details[0].path, 'target');
  } finally {
    await app.close();
  }
});

test('pings need no sign-in or header, accept any body, and bring the monitor to Healthy', async () => {
  const config = loadConfig({
    SQLITE_PATH: ':memory:',
    WORKER_ENABLED: 'false',
    ALERTS_ENABLED: 'true',
    LOG_LEVEL: 'silent',
  });
  const app = await buildApp(config, { sqlite: openDatabase(':memory:'), clickhouse: offlineClickHouse });
  try {
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: DASHBOARD,
      payload: { password: 'long enough' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: DASHBOARD,
      payload: { password: 'long enough' },
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const created = await app.inject({
      method: 'POST',
      url: '/api/alerting/monitors',
      headers: { ...DASHBOARD, cookie },
      payload: { type: 'heartbeat', criticalThreshold: 30 },
    });
    const { monitor } = created.json<{ monitor: AlertMonitor }>();

    // A cron job's curl: no session, no dashboard header, a form body.
    const ping = await app.inject({
      method: 'POST',
      url: `/heartbeat/${monitor.target}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'done=1',
    });
    assert.equal(ping.statusCode, 200);
    assert.equal(ping.json().status, 'ok');
    assert.equal((await app.inject({ url: `/heartbeat/${monitor.target}` })).statusCode, 200);
    assert.equal((await app.inject({ url: '/heartbeat/hb_nobody' })).statusCode, 404);

    const detail = await app.inject({ url: `/api/alerting/monitors/${monitor.id}`, headers: { cookie } });
    const after = detail.json<{ monitor: AlertMonitor }>().monitor;
    assert.equal(after.heartbeat?.pings, 2);
    assert.ok(after.heartbeat?.lastPingAt);
    assert.equal(after.state, 'ok');
    assert.equal(after.stateMessage, 'Last ping 0 min ago');
  } finally {
    await app.close();
  }
});

test('minutes since the last ping are measured to a tenth and never negative', () => {
  const now = Date.parse('2026-09-17T10:00:00Z');
  assert.equal(minutesSincePing({ heartbeat: null }, now), null);
  assert.equal(minutesSincePing({ heartbeat: { lastPingAt: null, pings: 0 } }, now), null);
  assert.equal(minutesSincePing({ heartbeat: { lastPingAt: '2026-09-17T09:45:30Z', pings: 1 } }, now), 14.5);
  assert.equal(minutesSincePing({ heartbeat: { lastPingAt: '2026-09-17T10:00:05Z', pings: 1 } }, now), 0);
});
