import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillSeries, timeWindow } from './time-window';

test('timeWindow aligns 1h to 60 one-minute buckets ending at the current bucket', () => {
  const now = Date.UTC(2026, 8, 14, 12, 30, 45);
  const window = timeWindow('1h', now);
  assert.equal(window.stepSeconds, 60);
  assert.equal(window.endSeconds, Date.UTC(2026, 8, 14, 12, 30, 0) / 1000);
  assert.equal((window.endSeconds - window.startSeconds) / 60 + 1, 60);
  assert.equal(window.fromMs, window.startSeconds * 1000);
});

test('fillSeries keeps existing buckets and fills gaps with empty points', () => {
  const window = timeWindow('1h', Date.UTC(2026, 8, 14, 12, 0, 0));
  const existing = { t: window.startSeconds + 60, checks: 2, failures: 1, avgLatencyMs: 120, p95LatencyMs: 180 };
  const points = fillSeries(window, [existing]);

  assert.equal(points.length, 60);
  assert.deepEqual(points[0], { t: window.startSeconds, checks: 0, failures: 0, avgLatencyMs: null, p95LatencyMs: null });
  assert.deepEqual(points[1], existing);
  assert.equal(points.at(-1)?.t, window.endSeconds);
});
