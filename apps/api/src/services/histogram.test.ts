import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BINS_PER_DOUBLING, fillHistogram } from './histogram';

test('buckets span the occupied bins, four per doubling, with empty ones filled', () => {
  assert.equal(BINS_PER_DOUBLING, 4);
  const buckets = fillHistogram([
    { bin: -1, requests: 3, errors: 0 },
    { bin: 4, requests: 10, errors: 1 },
    { bin: 5, requests: 4, errors: 0 },
  ]);
  assert.deepEqual(
    buckets.map((bucket) => [bucket.fromMs, bucket.toMs, bucket.requests]),
    [
      [0, 1, 3],
      [1, 1.19, 0],
      [1.19, 1.41, 0],
      [1.41, 1.68, 0],
      [1.68, 2, 0],
      [2, 2.38, 10],
      [2.38, 2.83, 4],
    ],
  );
  assert.equal(buckets[5]?.errors, 1);
});

test('256 to 512 ms is split into four buckets', () => {
  const bin = (ms: number) => Math.floor(Math.log2(ms) * BINS_PER_DOUBLING);
  const buckets = fillHistogram([{ bin: bin(300), requests: 1, errors: 0 }, { bin: bin(500), requests: 1, errors: 0 }]);
  assert.deepEqual(
    buckets.map((bucket) => bucket.fromMs),
    [256, 304.44, 362.04, 430.54],
  );
});

test('no requests, no buckets', () => {
  assert.deepEqual(fillHistogram([]), []);
});
