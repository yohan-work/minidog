'use client';

import { useMemo } from 'react';
import { formatLatency } from '@/lib/format';
import type { WaterfallModel } from '@/lib/waterfall';
import styles from './TraceWaterfall.module.scss';

// The model is plain data so it can be unit-tested without React or styles.
export { buildWaterfall, type WaterfallModel, type WaterfallRow } from '@/lib/waterfall';

const TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

interface TraceWaterfallProps {
  model: WaterfallModel;
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
}

/**
 * Span timeline. Bars are neutral; errors are red and the slowest span amber,
 * each also labelled in text.
 */
export function TraceWaterfall({ model, selectedSpanId, onSelect }: TraceWaterfallProps) {
  const ticks = useMemo(() => TICKS.map((tick) => ({ tick, label: formatLatency(model.durationMs * tick) })), [model.durationMs]);

  return (
    <div className={styles.waterfall}>
      <div className={styles.axis} aria-hidden>
        <span className={styles.axisLabel}>Span</span>
        <span className={styles.axisDuration}>Duration</span>
        <span className={styles.axisTrack}>
          {ticks.map(({ tick, label }) => (
            <span
              key={tick}
              className={styles.tick}
              style={{ left: `${tick * 100}%` }}
              data-edge={tick === 1 || undefined}
              data-minor={tick === 0.25 || tick === 0.75 || undefined}
            >
              {tick === 0 ? '0' : label}
            </span>
          ))}
        </span>
      </div>
      <ol className={styles.rows} aria-label="Spans">
        {model.rows.map((row) => {
          const { span } = row;
          const error = span.status === 'error';
          const slowest = span.spanId === model.slowestSpanId;
          const state = error ? 'error' : slowest ? 'slow' : 'default';
          return (
            <li key={span.spanId}>
              <button
                type="button"
                className={styles.row}
                aria-current={span.spanId === selectedSpanId || undefined}
                onClick={() => onSelect(span.spanId)}
              >
                <span className={styles.label} style={{ paddingLeft: `calc(var(--space-3) * ${row.depth})` }}>
                  <span className={styles.service}>{span.service}</span>
                  <span className={styles.name}>{span.name}</span>
                  {error && <span className={styles.errorTag}>Error</span>}
                  {slowest && !error && <span className={styles.slowTag}>Slowest</span>}
                </span>
                <span className={styles.duration}>{formatLatency(span.durationMs)}</span>
                <span className={styles.track}>
                  <span className={styles.bar} data-state={state} style={{ left: `${row.offsetPct}%`, width: `${row.widthPct}%` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
