import type { LatencyBucket } from '@minidog/types';
import type { RawLatencyBin } from '../repositories/span-repository';

/**
 * Power-of-two duration buckets from the fastest to the slowest occupied one,
 * gaps filled with zero so the shape of the distribution is visible. Bin -1
 * holds everything under 1 ms.
 */
export function fillHistogram(bins: readonly RawLatencyBin[]): LatencyBucket[] {
  if (bins.length === 0) return [];
  const byBin = new Map(bins.map((bin) => [bin.bin, bin]));
  const first = Math.min(...bins.map((bin) => bin.bin));
  const last = Math.max(...bins.map((bin) => bin.bin));

  const buckets: LatencyBucket[] = [];
  for (let bin = first; bin <= last; bin += 1) {
    const row = byBin.get(bin);
    buckets.push({
      fromMs: bin < 0 ? 0 : 2 ** bin,
      toMs: 2 ** (bin + 1),
      requests: row?.requests ?? 0,
      errors: row?.errors ?? 0,
    });
  }
  return buckets;
}
