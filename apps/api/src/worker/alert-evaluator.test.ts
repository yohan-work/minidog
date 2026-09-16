import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALERT_MONITOR_DEFAULTS } from '@minidog/types';
import type { FastifyBaseLogger } from 'fastify';
import { applyTransitionDelay } from '../services/alert-state';
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
function setupServiceDown(now: number, before: number, alertAfterMinutes = 0) {
  const db = openDatabase(':memory:');
  const { projectId, environment } = new ProjectRepository(db).ensureDefault();
  const scope = { projectId, environment };
  const monitors = new AlertMonitorRepository(db);
  const traffic = { now, before };
  const spans = {
    windowStats: async () => ({ requests: traffic.now, errors: 0, p95Ms: null }),
    // Only the window before the measured one is counted, and only when it is quiet.
    requestCount: async () => traffic.before,
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
    alertAfterMinutes,
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

test('an outage on its way to Critical is not dropped when the window before it empties', async () => {
  const { alertAfterMinutes } = ALERT_MONITOR_DEFAULTS.service_down;
  const { evaluator, monitor, traffic } = setupServiceDown(0, 120, alertAfterMinutes);

  // A new monitor starts at No data, which ranks with Healthy, so the delay applies here too.
  const pending = await evaluator.evaluate(monitor);
  assert.equal(pending.state, 'no_data', 'the delay holds the transition');
  assert.equal(pending.pendingState, 'critical');

  // By now it has been silent long enough that the window before this one is empty too.
  traffic.before = 0;
  const still = await evaluator.evaluate(pending);

  // The stored state stays where it was until the delay runs out; what matters is
  // that the transition on its way to Critical survived the window emptying.
  // Reaching Critical is covered by the delay test below.
  assert.equal(still.pendingState, 'critical', 'the outage would otherwise be forgotten and never reported');
  assert.equal(still.pendingSince, pending.pendingSince, 'and its clock keeps running rather than restarting');
});

test('the default delay reports the silence instead of swallowing it', () => {
  const { alertAfterMinutes, windowMinutes } = ALERT_MONITOR_DEFAULTS.service_down;
  const started = new Date('2026-09-16T04:00:00Z');
  const common = {
    stored: 'ok',
    derived: 'critical',
    alertAfterMinutes,
    recoverAfterMinutes: 0,
    maxGapMs: 120_000,
  } as const;

  const held = applyTransitionDelay({
    ...common,
    pending: null,
    at: started,
    lastEvaluatedAt: new Date(started.getTime() - 30_000).toISOString(),
  });
  assert.equal(held.state, 'ok');
  assert.equal(held.pending?.state, 'critical');

  const due = new Date(started.getTime() + alertAfterMinutes * 60_000);
  const fired = applyTransitionDelay({
    ...common,
    pending: held.pending,
    at: due,
    lastEvaluatedAt: new Date(due.getTime() - 30_000).toISOString(),
  });

  // A delay at or past the window used to mean the monitor could never fire:
  // the value turned to No data before the clock ran out.
  assert.equal(fired.state, 'critical', `${alertAfterMinutes} min delay with a ${windowMinutes} min window must fire`);
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
