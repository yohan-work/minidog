import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillHistogram } from './histogram';

test('buckets span the occupied bins with empty ones filled', () => {
  const buckets = fillHistogram([
    { bin: -1, requests: 3, errors: 0 },
    { bin: 2, requests: 10, errors: 1 },
    { bin: 3, requests: 4, errors: 0 },
  ]);
  assert.deepEqual(
    buckets.map((bucket) => [bucket.fromMs, bucket.toMs, bucket.requests]),
    [
      [0, 1, 3],
      [1, 2, 0],
      [2, 4, 0],
      [4, 8, 10],
      [8, 16, 4],
    ],
  );
  assert.equal(buckets[3]?.errors, 1);
});

test('no requests, no buckets', () => {
  assert.deepEqual(fillHistogram([]), []);
});
