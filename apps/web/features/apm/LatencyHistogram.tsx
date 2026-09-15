import { LATENCY_BINS_PER_DOUBLING, latencyBin, type LatencyBucket } from '@minidog/types';
import { formatCount, formatLatency, formatLatencyAxis } from '@/lib/format';
import styles from './LatencyHistogram.module.scss';

interface Percentile {
  label: string;
  valueMs: number | null;
}

const bucketLabel = (bucket: LatencyBucket) =>
  bucket.fromMs === 0
    ? `under ${formatLatency(bucket.toMs)}`
    : `${formatLatency(bucket.fromMs)}–${formatLatency(bucket.toMs)}`;

/**
 * Response times in logarithmic buckets, four per doubling. Each bar's failed
 * share is drawn in red at its base, and the percentiles mark the buckets
 * they fall in. Axis labels sit on the doublings (1, 2, 4 … ms) only.
 */
export function LatencyHistogram({
  buckets,
  percentiles,
}: {
  buckets: readonly LatencyBucket[];
  percentiles: readonly Percentile[];
}) {
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.requests));
  const total = buckets.reduce((sum, bucket) => sum + bucket.requests, 0);
  const busiest = buckets.reduce((best, bucket) => (bucket.requests > best.requests ? bucket : best), buckets[0]!);
  const marks = percentiles.flatMap((percentile) =>
    percentile.valueMs === null
      ? []
      : [{ ...percentile, index: buckets.findIndex((bucket) => bucket.bin === latencyBin(percentile.valueMs!)) }],
  );

  return (
    <figure className={styles.figure}>
      <div
        className={styles.bars}
        role="img"
        aria-label={`Response time distribution of ${formatCount(total)} requests; most took ${bucketLabel(busiest)}.`}
      >
        {buckets.map((bucket, index) => (
          <div
            key={bucket.bin}
            className={styles.column}
            title={`${bucketLabel(bucket)}: ${formatCount(bucket.requests)} requests${bucket.errors > 0 ? `, ${formatCount(bucket.errors)} failed` : ''}`}
          >
            <div className={styles.marks}>
              {marks
                .filter((mark) => mark.index === index)
                .map((mark) => (
                  <span key={mark.label} className={styles.mark}>
                    {mark.label}
                  </span>
                ))}
            </div>
            <div className={styles.track}>
              <div className={styles.bar} style={{ height: `${(bucket.requests / peak) * 100}%` }}>
                {bucket.errors > 0 && (
                  <div className={styles.errors} style={{ height: `${(bucket.errors / bucket.requests) * 100}%` }} />
                )}
              </div>
            </div>
            <span className={styles.label}>
              {bucket.bin < 0 || bucket.bin % LATENCY_BINS_PER_DOUBLING === 0 ? formatLatencyAxis(bucket.fromMs) : ''}
            </span>
          </div>
        ))}
      </div>
      <figcaption className={styles.caption}>
        Four bars per doubling of the response time · red = failed requests
      </figcaption>
    </figure>
  );
}
