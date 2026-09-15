import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../db/sqlite';
import { AlertMonitorRepository } from './alert-monitor-repository';
import { ProjectRepository } from './project-repository';

const at = new Date('2026-09-14T12:00:00Z');
const minutesLater = (minutes: number) => new Date(at.getTime() + minutes * 60_000);

function setup(delays: { alertAfterMinutes?: number; recoverAfterMinutes?: number } = {}) {
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
      ...delays,
    },
  );
  return { monitors, monitor };
}

const ok = { state: 'ok', value: 200, message: 'ok' } as const;
const critical = { state: 'critical', value: 650, message: 'critical' } as const;

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

test('alert after: the transition is recorded once the breach has lasted the delay', () => {
  const { monitors, monitor } = setup({ alertAfterMinutes: 5 });
  monitors.recordEvaluation(monitor, ok, at);

  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(1)), null);
  assert.equal(monitors.get(monitor.id)?.state, 'ok');
  assert.equal(monitors.get(monitor.id)?.pendingState, 'critical');
  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(5.5)), null, 'only 4.5 min so far');

  const event = monitors.recordEvaluation(monitor, critical, minutesLater(6));
  assert.equal(event?.fromState, 'ok');
  assert.equal(event?.toState, 'critical');
  assert.equal(monitors.get(monitor.id)?.pendingState, null);
});

test('alert after: a breach that clears restarts the clock', () => {
  const { monitors, monitor } = setup({ alertAfterMinutes: 5 });
  monitors.recordEvaluation(monitor, ok, at);

  monitors.recordEvaluation(monitor, critical, minutesLater(1));
  monitors.recordEvaluation(monitor, ok, minutesLater(3));
  assert.equal(monitors.get(monitor.id)?.pendingState, null);

  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(4)), null);
  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(8)), null, '4 min since the breach came back');
  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(9))?.toState, 'critical');
});

test('alert after: warning then critical keeps one clock', () => {
  const { monitors, monitor } = setup({ alertAfterMinutes: 5 });
  monitors.recordEvaluation(monitor, ok, at);

  monitors.recordEvaluation(monitor, { state: 'warning', value: 300, message: 'warning' }, minutesLater(1));
  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(4)), null);
  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(6))?.toState, 'critical');
});

test('recover after: recovery is reported only after it holds', () => {
  const { monitors, monitor } = setup({ recoverAfterMinutes: 10 });
  monitors.recordEvaluation(monitor, critical, at);

  assert.equal(monitors.recordEvaluation(monitor, ok, minutesLater(1)), null);
  assert.equal(monitors.get(monitor.id)?.state, 'critical');
  assert.equal(monitors.recordEvaluation(monitor, ok, minutesLater(10)), null);

  const recovery = monitors.recordEvaluation(monitor, ok, minutesLater(11));
  assert.equal(recovery?.fromState, 'critical');
  assert.equal(recovery?.toState, 'ok');
});

test('a held notification can be claimed once', () => {
  const { monitors, monitor } = setup();
  const event = monitors.recordEvaluation(monitor, critical, at)!;
  monitors.setWebhookStatus(event.id, 'muted');

  assert.equal(monitors.claimMutedEvent(event.id), true);
  assert.equal(monitors.claimMutedEvent(event.id), false);
});

test('a pending clock does not count time without evaluations', () => {
  const { monitors, monitor } = setup({ alertAfterMinutes: 5 });
  const gap = 2 * 60_000;
  monitors.recordEvaluation(monitor, ok, at, gap);
  monitors.recordEvaluation(monitor, critical, minutesLater(1), gap);

  // Evaluations stop (outage) and resume a day later with the breach still there.
  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(24 * 60), gap), null, 'no instant alert');
  assert.equal(monitors.get(monitor.id)?.pendingSince, minutesLater(24 * 60).toISOString(), 'the clock restarts');
  // Consecutive evaluations (every minute) then let the delay run out.
  for (const minute of [1, 2, 3, 4]) {
    assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(24 * 60 + minute), gap), null);
  }
  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(24 * 60 + 5), gap)?.toState, 'critical');
});

test('pausing or resuming clears a pending transition', () => {
  const { monitors, monitor } = setup({ alertAfterMinutes: 5 });
  monitors.recordEvaluation(monitor, ok, at);
  monitors.recordEvaluation(monitor, critical, minutesLater(1));
  assert.equal(monitors.get(monitor.id)?.pendingState, 'critical');

  monitors.update(monitor.id, { enabled: false });
  assert.equal(monitors.get(monitor.id)?.pendingState, null);
  assert.equal(monitors.get(monitor.id)?.pendingSince, null);

  monitors.update(monitor.id, { enabled: true });
  assert.equal(monitors.recordEvaluation(monitor, critical, minutesLater(10)), null, 'the delay starts again after resume');
});
