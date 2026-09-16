import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyBaseLogger } from 'fastify';
import { openDatabase } from '../db/sqlite';
import { AlertMonitorRepository } from '../repositories/alert-monitor-repository';
import type { MetricRepository } from '../repositories/metric-repository';
import { MonitorRepository } from '../repositories/monitor-repository';
import { ProjectRepository } from '../repositories/project-repository';
import type { SpanRepository } from '../repositories/span-repository';
import type { SyntheticResultRepository } from '../repositories/synthetic-result-repository';
import { AlertingService } from '../services/alerting-service';
import { AlertEvaluator } from './alert-evaluator';

const silentLog = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;

/** An API service whose P95 is `p95Ms`, or whose query fails with the given error. */
function setup(p95Ms: number | Error) {
  const db = openDatabase(':memory:');
  const { projectId, environment } = new ProjectRepository(db).ensureDefault();
  const scope = { projectId, environment };
  const monitors = new AlertMonitorRepository(db);
  const spans = {
    windowStats: async () => {
      if (p95Ms instanceof Error) throw p95Ms;
      return { requests: 100, errors: 0, p95Ms };
    },
  } as unknown as SpanRepository;
  const syntheticMonitors = new MonitorRepository(db);
  const evaluator = new AlertEvaluator({
    monitors,
    spans,
    metrics: {} as MetricRepository,
    syntheticMonitors,
    syntheticResults: {} as SyntheticResultRepository,
    log: silentLog,
    intervalMs: 30_000,
  });
  const latency = () =>
    monitors.create(scope, {
      name: 'P95 · api',
      type: 'latency',
      target: 'api',
      metric: null,
      warningThreshold: 250,
      criticalThreshold: 500,
      windowMinutes: 1,
      webhookUrl: '',
    });
  const service = (automaticEvaluation: boolean) =>
    new AlertingService(monitors, evaluator, scope, automaticEvaluation, syntheticMonitors);
  return { monitors, evaluator, latency, service };
}

const input = {
  type: 'latency',
  target: 'api',
  warningThreshold: 250,
  criticalThreshold: 500,
  windowMinutes: 1,
} as const;

/** A service whose traffic differs between the measured window and the one before it. */
function setupServiceDown(now: number, before: number) {
  const db = openDatabase(':memory:');
  const { projectId, environment } = new ProjectRepository(db).ensureDefault();
  const scope = { projectId, environment };
  const monitors = new AlertMonitorRepository(db);
  const traffic = { now, before };
  const spans = {
    // The evaluator asks for the previous window by passing an upper bound.
    windowStats: async (_scope: unknown, _service: string, _fromMs: number, toMs?: number) => ({
      requests: toMs === undefined ? traffic.now : traffic.before,
      errors: 0,
      p95Ms: null,
    }),
  } as unknown as SpanRepository;
  const evaluator = new AlertEvaluator({
    monitors,
    spans,
    metrics: {} as MetricRepository,
    syntheticMonitors: new MonitorRepository(db),
    syntheticResults: {} as SyntheticResultRepository,
    log: silentLog,
    intervalMs: 30_000,
  });
  const monitor = monitors.create(scope, {
    name: 'Requests · api',
    type: 'service_down',
    target: 'api',
    metric: null,
    warningThreshold: null,
    criticalThreshold: 1,
    windowMinutes: 5,
    webhookUrl: '',
    // The measurement is what these tests are about, not the delay before it alerts.
    alertAfterMinutes: 0,
  });
  return { evaluator, monitor, traffic };
}

test('a service that is quiet in both windows is not called down', async () => {
  const { evaluator, monitor } = setupServiceDown(0, 0);

  const result = await evaluator.evaluate(monitor);

  // Four in the morning on a side project: nobody visited, nothing is wrong.
  assert.equal(result.state, 'no_data');
});

test('a service that was receiving requests and stopped is down', async () => {
  const { evaluator, monitor } = setupServiceDown(0, 120);

  const result = await evaluator.evaluate(monitor);

  assert.equal(result.state, 'critical');
  assert.match(result.stateMessage, /No requests/);
});

test('a service that stays down is not reported as recovered when its quiet hours begin', async () => {
  const { evaluator, monitor, traffic } = setupServiceDown(0, 120);
  const down = await evaluator.evaluate(monitor);
  assert.equal(down.state, 'critical');

  // It has now been down long enough that the window before is empty as well.
  traffic.before = 0;
  const stillDown = await evaluator.evaluate(down);

  assert.equal(stillDown.state, 'critical', 'a monitor already alerting keeps measuring silence as down');
});

test('thresholds changed after a pass loaded its monitors apply to the evaluation', async () => {
  const { monitors, evaluator, latency } = setup(600);
  const loadedByPass = latency();
  monitors.update(loadedByPass.id, { warningThreshold: 700, criticalThreshold: 900 });

  const result = await evaluator.evaluate(loadedByPass);

  assert.equal(result.state, 'ok', 'no false critical from the old 500 ms threshold');
  assert.deepEqual(
    monitors.eventsForMonitor(loadedByPass.id, 10).map((event) => event.toState),
    ['ok'],
  );
});

test('a monitor paused after a pass loaded its monitors is not evaluated', async () => {
  const { monitors, evaluator, latency } = setup(600);
  const loadedByPass = latency();
  monitors.update(loadedByPass.id, { enabled: false });

  const result = await evaluator.evaluate(loadedByPass);

  assert.equal(result.state, 'no_data');
  assert.equal(monitors.eventsForMonitor(loadedByPass.id, 10).length, 0);
});

test('a new monitor is evaluated as soon as it is created', async () => {
  const { service } = setup(600);
  const monitor = await service(true).create(input);
  assert.equal(monitor.state, 'critical');
});

test('with ALERTS_ENABLED=false saving a monitor neither evaluates nor notifies', async () => {
  const { monitors, service } = setup(600);
  const monitor = await service(false).create(input);
  assert.equal(monitor.state, 'no_data');
  assert.equal(monitors.eventsForMonitor(monitor.id, 10).length, 0);
});

test('an evaluation error after saving does not fail the request', async () => {
  const { service } = setup(new Error('Code: 47. Unknown expression identifier'));
  const alerting = service(true);

  const created = await alerting.create(input);
  const updated = await alerting.update(created.id, { criticalThreshold: 800 });

  assert.equal(created.state, 'no_data');
  assert.equal(updated.criticalThreshold, 800);
  assert.equal(alerting.list().monitors.length, 1, 'the saved monitor is returned, so there is no reason to retry');
});
