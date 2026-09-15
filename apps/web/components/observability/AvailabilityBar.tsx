import type { MeasurementGap, SeriesPoint } from '@minidog/types';
import { formatDateTime, formatPercent } from '@/lib/format';
import { formatGapDuration, GAP_REASONS, gapOverlapMs, totalGapMs } from '@/lib/gaps';
import styles from './AvailabilityBar.module.scss';

type BucketState = 'empty' | 'gap' | 'up' | 'partial' | 'down';

interface Bucket {
  point: SeriesPoint;
  state: BucketState;
  /** Set for `gap` buckets. */
  reason?: MeasurementGap['reason'];
}

function toBucket(point: SeriesPoint, stepSeconds: number, gaps: readonly MeasurementGap[]): Bucket {
  if (point.checks > 0)
    return { point, state: point.failures === 0 ? 'up' : point.failures === point.checks ? 'down' : 'partial' };
  const fromMs = point.t * 1000;
  const toMs = fromMs + stepSeconds * 1000;
  // Mostly unmeasured: nothing could have run, which is not the same as "no checks".
  if (gapOverlapMs(gaps, fromMs, toMs) * 2 >= toMs - fromMs) {
    const gap = gaps.find((item) => item.to > fromMs && item.from < toMs);
    return { point, state: 'gap', reason: gap?.reason };
  }
  return { point, state: 'empty' };
}

function describe({ point, state, reason }: Bucket): string {
  const when = formatDateTime(point.t * 1000);
  if (state === 'gap') return `${when} — not measured (${GAP_REASONS[reason ?? 'stopped']})`;
  if (point.checks === 0) return `${when} — no checks`;
  const availability = formatPercent((point.checks - point.failures) / point.checks);
  return `${when} — ${availability} (${point.checks} checks, ${point.failures} failed)`;
}

/**
 * One bar per time bucket. Empty buckets are drawn shorter so "no data" never
 * looks like "healthy"; stretches when minidog could not measure are hatched.
 * The text summary repeats the result without color.
 */
export function AvailabilityBar({
  points,
  stepSeconds,
  gaps = [],
}: {
  points: readonly SeriesPoint[];
  stepSeconds: number;
  gaps?: readonly MeasurementGap[];
}) {
  const buckets = points.map((point) => toBucket(point, stepSeconds, gaps));
  const checked = points.filter((point) => point.checks > 0);
  const failing = checked.filter((point) => point.failures > 0).length;
  const unmeasured = totalGapMs(gaps);
  const result =
    checked.length === 0
      ? 'No checks in this range'
      : failing === 0
        ? `All ${checked.length} intervals passed`
        : `${failing} of ${checked.length} intervals had failures`;
  const summary = unmeasured > 0 ? `${result} · not measured for ${formatGapDuration(unmeasured)}` : result;

  return (
    <figure className={styles.figure}>
      <div className={styles.bars} role="img" aria-label={`Availability timeline: ${summary}.`}>
        {buckets.map((bucket) => (
          <span key={bucket.point.t} className={styles.bar} data-state={bucket.state} title={describe(bucket)} />
        ))}
      </div>
      <figcaption className={styles.caption}>
        <span>{points[0] ? formatDateTime(points[0].t * 1000) : ''}</span>
        <span className={styles.summary} data-failing={failing > 0 || undefined}>
          {summary}
        </span>
        <span>Now</span>
      </figcaption>
    </figure>
  );
}
