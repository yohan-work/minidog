import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareToBaseline } from './baseline';

test('a week with no requests is no baseline', () => {
  assert.equal(
    compareToBaseline({ requests: 10, errors: 0, p95Ms: 100 }, { requests: 0, errors: 0, p95Ms: null }),
    null,
  );
});

test('changes are ratios for requests and P95, percentage points for the error rate', () => {
  const baseline = compareToBaseline(
    { requests: 300, errors: 6, p95Ms: 412 },
    { requests: 200, errors: 1, p95Ms: 100 },
  );
  assert.ok(baseline);
  assert.equal(baseline.requests, 200);
  assert.equal(baseline.p95Ms, 100);
  assert.equal(baseline.requestsChange, 0.5);
  assert.equal(baseline.p95Change, 3.12);
  // 2% now against 0.5% last week: +1.5 points, not "+300%".
  assert.equal(Math.round((baseline.errorRateChange ?? 0) * 1000) / 1000, 0.015);
  assert.equal(baseline.errorRate, 0.005);
});

test('a window with no requests now still reports last week, without changes it cannot compute', () => {
  const baseline = compareToBaseline({ requests: 0, errors: 0, p95Ms: null }, { requests: 50, errors: 5, p95Ms: 80 });
  assert.ok(baseline);
  assert.equal(baseline.requestsChange, -1);
  assert.equal(baseline.errorRateChange, null);
  assert.equal(baseline.p95Change, null);
});
