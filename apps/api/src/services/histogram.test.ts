import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LATENCY_BINS_PER_DOUBLING, latencyBin } from '@minidog/types';
import { fillHistogram } from './histogram';

test('buckets span the occupied bins, four per doubling, with empty ones filled', () => {
  assert.equal(LATENCY_BINS_PER_DOUBLING, 4);
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
  const buckets = fillHistogram([{ bin: latencyBin(300), requests: 1, errors: 0 }, { bin: latencyBin(500), requests: 1, errors: 0 }]);
  assert.deepEqual(
    buckets.map((bucket) => bucket.fromMs),
    [256, 304.44, 362.04, 430.54],
  );
});

test('no requests, no buckets', () => {
  assert.deepEqual(fillHistogram([]), []);
});

test('a value is placed by its bin, not by rounded bounds', () => {
  const buckets = fillHistogram([{ bin: 4, requests: 1, errors: 0 }, { bin: 5, requests: 1, errors: 0 }]);
  // Bin 5 is [2.3784, 2.8284) ms; its bounds display as 2.38 and 2.83.
  assert.equal(buckets.find((bucket) => bucket.bin === latencyBin(2.3790))?.fromMs, 2.38, 'not bin 4, whose rounded top is 2.38');
  assert.equal(buckets.find((bucket) => bucket.bin === latencyBin(2.8283))?.fromMs, 2.38, 'still found although it rounds to the top bound');
  assert.equal(latencyBin(0.4), -1);
});
