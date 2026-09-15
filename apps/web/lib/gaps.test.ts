import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatGapDuration, gapOverlapMs, totalGapMs } from './gaps';

const gaps = [
  { from: 1_000, to: 5_000, reason: 'asleep' as const },
  { from: 8_000, to: 9_000, reason: 'stopped' as const },
];

test('overlap counts only the part of each gap inside the bucket', () => {
  assert.equal(gapOverlapMs(gaps, 0, 2_000), 1_000);
  assert.equal(gapOverlapMs(gaps, 4_000, 8_500), 1_500);
  assert.equal(gapOverlapMs(gaps, 5_000, 8_000), 0);
  assert.equal(totalGapMs(gaps), 5_000);
});

test('durations read naturally', () => {
  assert.equal(formatGapDuration(40_000), '40 s');
  assert.equal(formatGapDuration(12 * 60_000), '12 min');
  assert.equal(formatGapDuration(130 * 60_000), '2 h 10 min');
  assert.equal(formatGapDuration(3 * 60 * 60_000), '3 h');
  assert.equal(formatGapDuration((3 * 24 + 4) * 60 * 60_000), '3 d 4 h');
});
