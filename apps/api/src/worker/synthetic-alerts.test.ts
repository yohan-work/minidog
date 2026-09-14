import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import type { FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';
import { openDatabase } from '../db/sqlite';
import { AlertMonitorRepository } from '../repositories/alert-monitor-repository';
import type { MetricRepository } from '../repositories/metric-repository';
import { MonitorRepository } from '../repositories/monitor-repository';
import { ProjectRepository } from '../repositories/project-repository';
import type { SpanRepository } from '../repositories/span-repository';
import type { RawMonitorSummary, SyntheticResultRepository } from '../repositories/synthetic-result-repository';
import { AlertingService } from '../services/alerting-service';
import { AlertEvaluator } from './alert-evaluator';

const silentLog = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;
const DAY = 24 * 60 * 60 * 1000;

// A local webhook receiver; every POST body is kept.
let server: Server;
let webhookUrl: string;
let received: { text: string; note?: string }[] = [];

before(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      received.push(JSON.parse(body));
      response.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});

after(() => {
  server.close();
});

beforeEach(() => {
  received = [];
});

function summary(overrides: Partial<RawMonitorSummary>): RawMonitorSummary {
  return {
    lastCheckedAt: Date.now() - 10_000,
    lastStatus: 'up',
    lastStatusCode: 200,
    lastLatencyMs: 100,
    lastError: '',
    sslExpiresAt: null,
    checks: 5,
    failures: 0,
    p95LatencyMs: 120,
    avgLatencyMs: 100,
    recentStatuses: [],
    ...overrides,
  };
}

/** One synthetic check whose results are `current`, and alerting on top of it. */
function setup(initial: Partial<RawMonitorSummary> | null) {
  const db = openDatabase(':memory:');
  const { projectId, environment } = new ProjectRepository(db).ensureDefault();
  const scope = { projectId, environment };
  const monitors = new AlertMonitorRepository(db);
  const checks = new MonitorRepository(db);
  const check = checks.create(scope, {
    name: 'yohan.co.kr',
    url: 'https://www.yohan.co.kr/',
    method: 'GET',
    intervalSeconds: 60,
    timeoutMs: 10_000,
    expectedStatus: '200-399',
  });

  let current = initial;
  const syntheticResults = {
    summaries: async (_scope: unknown, ids: readonly string[]) => new Map(current ? [[ids[0]!, summary(current)]] : []),
  } as unknown as SyntheticResultRepository;

  const evaluator = new AlertEvaluator({
    monitors,
    spans: {} as SpanRepository,
    metrics: {} as MetricRepository,
    syntheticMonitors: checks,
    syntheticResults,
    log: silentLog,
    intervalMs: 30_000,
  });
  const alerting = new AlertingService(monitors, evaluator, scope, true, checks);
  return {
    monitors,
    evaluator,
    alerting,
    check,
    setResults: (next: Partial<RawMonitorSummary> | null) => {
      current = next;
    },
  };
}

test('failed checks: critical when the share of failures reaches the threshold', async () => {
  const { alerting, check } = setup({ checks: 5, failures: 3 });
  const monitor = await alerting.create({ type: 'synthetic_check', target: check.id, metric: 'failure_rate' });

  assert.equal(monitor.state, 'critical');
  assert.equal(monitor.stateValue, 60);
  assert.equal(monitor.stateMessage, 'Failed checks 60.0% ≥ critical 50.0% (last 5 min)');
  assert.equal(monitor.name, 'Failed checks · yohan.co.kr');
  assert.equal(monitor.targetLabel, 'yohan.co.kr');
});

test('response time uses the P95 of passing checks', async () => {
  const { alerting, check } = setup({ p95LatencyMs: 1_420 });
  const monitor = await alerting.create({ type: 'synthetic_check', target: check.id, metric: 'response_time' });
  assert.equal(monitor.state, 'warning');
  assert.equal(monitor.stateMessage, 'Response time 1.42 s ≥ warning 1.00 s (last 5 min)');
});

test('SSL expiry alerts below the number of days left', async () => {
  const { alerting, check, setResults, evaluator, monitors } = setup({ sslExpiresAt: Date.now() + 5 * DAY + 60_000 });
  const monitor = await alerting.create({ type: 'synthetic_check', target: check.id, metric: 'ssl_days' });
  assert.equal(monitor.state, 'critical');
  assert.equal(monitor.stateMessage, 'SSL expiry 5 days < critical 7 days');

  setResults({ sslExpiresAt: Date.now() + 80 * DAY });
  const renewed = await evaluator.evaluate(monitors.get(monitor.id)!);
  assert.equal(renewed.state, 'ok');
});

test('no checks in the window is No data, not Healthy', async () => {
  const { alerting, check } = setup({ checks: 0, failures: 0 });
  const monitor = await alerting.create({ type: 'synthetic_check', target: check.id });
  assert.equal(monitor.state, 'no_data');
  assert.equal(monitor.stateMessage, 'No checks in the last 5 min');
});

test('the target must be a synthetic monitor of the environment', async () => {
  const { alerting } = setup(null);
  await assert.rejects(alerting.create({ type: 'synthetic_check', target: 'mon_missing' }), (error) => {
    assert.ok(error instanceof ZodError);
    assert.equal(error.issues[0]?.path[0], 'target');
    return true;
  });
  await assert.rejects(alerting.create({ type: 'synthetic_check', target: 'x', metric: 'cpu' }), ZodError);
});

test('alert after: a breach shorter than the delay stays pending and does not notify', async () => {
  const { alerting, check, evaluator } = setup({ checks: 5, failures: 5 });
  const monitor = await alerting.create({
    type: 'synthetic_check',
    target: check.id,
    webhookUrl,
    alertAfterMinutes: 5,
  });
  await evaluator.settled();

  assert.equal(monitor.state, 'no_data');
  assert.equal(monitor.pendingState, 'critical');
  assert.notEqual(monitor.pendingSince, null);
  assert.equal(received.length, 0);
});

test('a mute holds the notification and sends it once when the mute ends', async () => {
  const { alerting, check, evaluator, monitors, setResults } = setup({ checks: 5, failures: 0 });
  const created = await alerting.create({ type: 'synthetic_check', target: check.id, webhookUrl });
  alerting.mute(created.id, 60);

  setResults({ checks: 5, failures: 5 });
  const down = await evaluator.evaluate(monitors.get(created.id)!);
  await evaluator.settled();
  assert.equal(down.state, 'critical');
  assert.equal(received.length, 0, 'nothing is sent while muted');
  assert.equal(monitors.lastEvent(created.id)?.webhookStatus, 'muted');

  await alerting.unmute(created.id);
  await evaluator.settled();
  assert.equal(received.length, 1);
  assert.match(received[0]!.text, /^\[CRITICAL\] Failed checks · yohan\.co\.kr: .*\(still critical after the mute ended\)$/);
  assert.equal(monitors.lastEvent(created.id)?.webhookStatus, 'sent 200');

  await evaluator.evaluate(monitors.get(created.id)!);
  await evaluator.settled();
  assert.equal(received.length, 1, 'the held notification is delivered only once');
});

test('a recovery during the mute is not sent afterwards', async () => {
  const { alerting, check, evaluator, monitors, setResults } = setup({ checks: 5, failures: 0 });
  const created = await alerting.create({ type: 'synthetic_check', target: check.id, webhookUrl });
  alerting.mute(created.id, 60);

  setResults({ checks: 5, failures: 5 });
  await evaluator.evaluate(monitors.get(created.id)!);
  setResults({ checks: 5, failures: 0 });
  await evaluator.evaluate(monitors.get(created.id)!);

  await alerting.unmute(created.id);
  await evaluator.settled();
  assert.equal(received.length, 0);
});
