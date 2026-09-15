import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customWindow, fillSeries, queryBounds, timeWindow } from './time-window';

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

test('customWindow keeps at most 120 buckets and aligns them', () => {
  const from = Date.UTC(2026, 8, 15, 9, 1, 12);
  const tenMinutes = customWindow(from, from + 10 * 60_000);
  assert.equal(tenMinutes.stepSeconds, 10);
  assert.equal(tenMinutes.startSeconds, Date.UTC(2026, 8, 15, 9, 1, 10) / 1000);

  assert.equal(customWindow(from, from + 60 * 60_000).stepSeconds, 30);
  assert.equal(customWindow(from, from + 7 * 24 * 60 * 60_000).stepSeconds, 7200);
});

test('queryBounds prefers an absolute window over the preset range', () => {
  assert.deepEqual(queryBounds('1h', 1_000, 2_000), { fromMs: 1_000, toMs: 2_000 });
  assert.equal(queryBounds('1h').toMs, undefined);
});
