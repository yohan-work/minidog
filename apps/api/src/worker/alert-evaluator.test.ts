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

const input = { type: 'latency', target: 'api', warningThreshold: 250, criticalThreshold: 500, windowMinutes: 1 } as const;

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
