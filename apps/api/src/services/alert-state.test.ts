import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertDirection } from '@minidog/types';
import { alertMessage, applyTransitionDelay, deriveAlertState, isMuted, thresholdsInOrder } from './alert-state';

test('above: warning and critical as the value rises', () => {
  const thresholds = { warning: 1000, critical: 2000 };
  assert.equal(deriveAlertState(250, thresholds, 'above'), 'ok');
  assert.equal(deriveAlertState(1000, thresholds, 'above'), 'warning');
  assert.equal(deriveAlertState(2400, thresholds, 'above'), 'critical');
});

test('below: Service Down is critical when requests fall under the threshold', () => {
  const thresholds = { warning: null, critical: 1 };
  assert.equal(deriveAlertState(0, thresholds, 'below'), 'critical');
  assert.equal(deriveAlertState(12, thresholds, 'below'), 'ok');
  assert.equal(deriveAlertState(5, { warning: 10, critical: 1 }, 'below'), 'warning');
});

test('no data without a value; warning is optional', () => {
  assert.equal(deriveAlertState(null, { warning: 1, critical: 2 }, 'above'), 'no_data');
  assert.equal(deriveAlertState(1.5, { warning: null, critical: 2 }, 'above'), 'ok');
});

test('threshold order depends on the direction', () => {
  assert.equal(thresholdsInOrder({ warning: 1000, critical: 2000 }, 'above'), true);
  assert.equal(thresholdsInOrder({ warning: 3000, critical: 2000 }, 'above'), false);
  assert.equal(thresholdsInOrder({ warning: 10, critical: 1 }, 'below'), true);
  assert.equal(thresholdsInOrder({ warning: null, critical: 1 }, 'below'), true);
});

test('messages name the signal, value and threshold', () => {
  const latency = {
    type: 'latency' as const,
    metric: null,
    windowMinutes: 5,
    thresholds: { warning: 1000, critical: 2000 },
  };
  assert.equal(alertMessage(latency, 'warning', 1420), 'P95 1.42 s ≥ warning 1.00 s (last 5 min)');
  assert.equal(alertMessage(latency, 'critical', 2500), 'P95 2.50 s ≥ critical 2.00 s (last 5 min)');
  assert.equal(alertMessage(latency, 'ok', 180), 'P95 180 ms within thresholds (last 5 min)');
  assert.equal(alertMessage(latency, 'no_data', null), 'No data in the last 5 min');

  const down = {
    type: 'service_down' as const,
    metric: null,
    windowMinutes: 10,
    thresholds: { warning: null, critical: 1 },
  };
  assert.equal(alertMessage(down, 'critical', 0), 'No requests in the last 10 min');

  const memory = {
    type: 'host_resource' as const,
    metric: 'memory' as const,
    windowMinutes: 5,
    thresholds: { warning: 85, critical: 95 },
  };
  assert.equal(alertMessage(memory, 'critical', 96.24), 'Memory 96.2% ≥ critical 95.0% (last 5 min)');
});

test('synthetic SSL expiry alerts below; other synthetic signals above', () => {
  assert.equal(alertDirection('synthetic_check', 'ssl_days'), 'below');
  assert.equal(alertDirection('synthetic_check', 'failure_rate'), 'above');
  assert.equal(thresholdsInOrder({ warning: 14, critical: 7 }, alertDirection('synthetic_check', 'ssl_days')), true);

  const ssl = {
    type: 'synthetic_check' as const,
    metric: 'ssl_days' as const,
    windowMinutes: 60,
    thresholds: { warning: 14, critical: 7 },
  };
  assert.equal(deriveAlertState(10.5, ssl.thresholds, 'below'), 'warning');
  assert.equal(alertMessage(ssl, 'warning', 10.5), 'SSL expiry 10 days < warning 14 days');
  assert.equal(alertMessage(ssl, 'critical', -1), 'SSL certificate expired');
  assert.equal(alertMessage(ssl, 'no_data', null), 'No SSL certificate in recent checks');
});

test('transition delay: immediate without a delay, pending with one', () => {
  const at = new Date('2026-09-14T12:00:00Z');
  const base = {
    stored: 'ok',
    pending: null,
    at,
    alertAfterMinutes: 0,
    recoverAfterMinutes: 0,
    lastEvaluatedAt: null,
    maxGapMs: 120_000,
  } as const;

  assert.deepEqual(applyTransitionDelay({ ...base, derived: 'critical' }), { state: 'critical', pending: null });
  assert.deepEqual(applyTransitionDelay({ ...base, derived: 'critical', alertAfterMinutes: 5 }), {
    state: 'ok',
    pending: { state: 'critical', since: at.toISOString() },
  });
  // Healthy and No data are equally quiet; moving between them is never delayed.
  assert.deepEqual(applyTransitionDelay({ ...base, derived: 'no_data', recoverAfterMinutes: 5 }), {
    state: 'no_data',
    pending: null,
  });
});

test('muted only until the given time', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  assert.equal(isMuted('2026-09-14T13:00:00Z', now), true);
  assert.equal(isMuted('2026-09-14T11:00:00Z', now), false);
  assert.equal(isMuted(null, now), false);
});
