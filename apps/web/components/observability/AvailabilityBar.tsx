import type { SeriesPoint } from '@minidog/types';
import { formatDateTime, formatPercent } from '@/lib/format';
import styles from './AvailabilityBar.module.scss';

type BucketState = 'empty' | 'up' | 'partial' | 'down';

function bucketState(point: SeriesPoint): BucketState {
  if (point.checks === 0) return 'empty';
  if (point.failures === 0) return 'up';
  return point.failures === point.checks ? 'down' : 'partial';
}

function describe(point: SeriesPoint): string {
  const when = formatDateTime(point.t * 1000);
  if (point.checks === 0) return `${when} — no checks`;
  const availability = formatPercent((point.checks - point.failures) / point.checks);
  return `${when} — ${availability} (${point.checks} checks, ${point.failures} failed)`;
}

/**
 * One bar per time bucket. Empty buckets are drawn shorter so "no data" never
 * looks like "healthy"; the text summary repeats the result without color.
 */
export function AvailabilityBar({ points }: { points: readonly SeriesPoint[] }) {
  const checked = points.filter((point) => point.checks > 0);
  const failing = checked.filter((point) => point.failures > 0).length;
  const summary =
    checked.length === 0
      ? 'No checks in this range'
      : failing === 0
        ? `All ${checked.length} intervals passed`
        : `${failing} of ${checked.length} intervals had failures`;

  return (
    <figure className={styles.figure}>
      <div className={styles.bars} role="img" aria-label={`Availability timeline: ${summary}.`}>
        {points.map((point) => (
          <span key={point.t} className={styles.bar} data-state={bucketState(point)} title={describe(point)} />
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
