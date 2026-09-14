import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../db/sqlite';
import { AlertMonitorRepository } from './alert-monitor-repository';
import { ProjectRepository } from './project-repository';

const at = new Date('2026-09-14T12:00:00Z');

function setup() {
  const db = openDatabase(':memory:');
  const { projectId, environment } = new ProjectRepository(db).ensureDefault();
  const monitors = new AlertMonitorRepository(db);
  const monitor = monitors.create(
    { projectId, environment },
    {
      name: 'P95 · api',
      type: 'latency',
      target: 'api',
      metric: null,
      warningThreshold: 250,
      criticalThreshold: 500,
      windowMinutes: 1,
      webhookUrl: '',
    },
  );
  return { monitors, monitor };
}

test('records an event only when the state changes', () => {
  const { monitors, monitor } = setup();

  const first = monitors.recordEvaluation(monitor, { state: 'ok', value: 200, message: 'P95 200 ms' }, at);
  assert.equal(first?.fromState, 'no_data');
  assert.equal(first?.toState, 'ok');

  const unchanged = monitors.recordEvaluation(monitors.get(monitor.id)!, { state: 'ok', value: 210, message: 'P95 210 ms' }, at);
  assert.equal(unchanged, null);
  assert.equal(monitors.get(monitor.id)?.stateValue, 210, 'the latest value is stored without an event');
  assert.equal(monitors.eventsForMonitor(monitor.id, 10).length, 1);
});

test('two evaluations from the same snapshot record the transition once', () => {
  const { monitors, monitor } = setup();
  const snapshot = monitors.get(monitor.id)!;

  const scheduled = monitors.recordEvaluation(snapshot, { state: 'warning', value: 300, message: 'warning' }, at);
  const manual = monitors.recordEvaluation(snapshot, { state: 'warning', value: 305, message: 'warning' }, at);

  assert.equal(scheduled?.toState, 'warning');
  assert.equal(manual, null, 'no duplicate event, so no duplicate webhook');
  assert.equal(monitors.eventsForMonitor(monitor.id, 10).length, 1);
});

test('a transition starts from the stored state, not a stale snapshot', () => {
  const { monitors, monitor } = setup();
  const snapshot = monitors.get(monitor.id)!;

  monitors.recordEvaluation(snapshot, { state: 'warning', value: 300, message: 'warning' }, at);
  const escalation = monitors.recordEvaluation(snapshot, { state: 'critical', value: 650, message: 'critical' }, at);

  assert.equal(escalation?.fromState, 'warning');
  assert.equal(escalation?.toState, 'critical');
});

test('an evaluation of a deleted monitor records nothing', () => {
  const { monitors, monitor } = setup();
  monitors.delete(monitor.id);
  assert.equal(monitors.recordEvaluation(monitor, { state: 'critical', value: 900, message: 'critical' }, at), null);
});
