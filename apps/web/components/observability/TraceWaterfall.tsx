'use client';

import { useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { formatLatency } from '@/lib/format';
import { type WaterfallModel, visibleRows } from '@/lib/waterfall';
import styles from './TraceWaterfall.module.scss';

// The model is plain data so it can be unit-tested without React or styles.
export { buildWaterfall, type WaterfallModel, type WaterfallRow } from '@/lib/waterfall';

const TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

interface TraceWaterfallProps {
  model: WaterfallModel;
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
  /** Spans whose children are hidden. */
  collapsed: ReadonlySet<string>;
  onToggle: (spanId: string) => void;
  /** Narrows the rows to matching spans and the path down to them. */
  query: string;
}

/**
 * Span timeline. Bars are neutral; errors are red and the slowest span amber,
 * each also labelled in text. Spans with children fold; a search keeps the
 * matches and their ancestors, dimming the ancestors.
 */
export function TraceWaterfall({ model, selectedSpanId, onSelect, collapsed, onToggle, query }: TraceWaterfallProps) {
  const ticks = useMemo(
    () => TICKS.map((tick) => ({ tick, label: formatLatency(model.durationMs * tick) })),
    [model.durationMs],
  );
  const rows = useMemo(() => visibleRows(model, { collapsed, query }), [model, collapsed, query]);

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
      {rows.length === 0 ? (
        <p className={styles.noMatch} role="status">
          No span matches “{query.trim()}”.
        </p>
      ) : (
        <ol className={styles.rows} aria-label="Spans">
          {rows.map((row) => {
            const { span } = row;
            const error = span.status === 'error';
            const slowest = span.spanId === model.slowestSpanId;
            const state = error ? 'error' : slowest ? 'slow' : 'default';
            return (
              <li key={span.spanId} className={styles.item} data-dim={!row.matches || undefined}>
                {row.childCount > 0 && (
                  <button
                    type="button"
                    className={styles.toggle}
                    style={{ left: `calc(var(--content-padding) + var(--space-3) * ${row.depth})` }}
                    aria-expanded={!row.collapsed}
                    aria-label={`${row.collapsed ? 'Expand' : 'Collapse'} ${span.name} (${row.descendantCount} below)`}
                    onClick={() => onToggle(span.spanId)}
                    disabled={query.trim() !== ''}
                  >
                    <Icon name="chevron-down" size={12} className={styles.chevron} />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.row}
                  aria-current={span.spanId === selectedSpanId || undefined}
                  onClick={() => onSelect(span.spanId)}
                >
                  <span
                    className={styles.label}
                    style={{ paddingLeft: `calc(var(--space-3) * ${row.depth} + var(--space-4))` }}
                  >
                    <span className={styles.service}>{span.service}</span>
                    <span className={styles.name}>{span.name}</span>
                    {row.collapsed && <span className={styles.hiddenCount}>+{row.descendantCount}</span>}
                    {error && <span className={styles.errorTag}>Error</span>}
                    {slowest && !error && <span className={styles.slowTag}>Slowest</span>}
                  </span>
                  <span className={styles.duration}>{formatLatency(span.durationMs)}</span>
                  <span className={styles.track}>
                    <span
                      className={styles.bar}
                      data-state={state}
                      style={{ left: `${row.offsetPct}%`, width: `${row.widthPct}%` }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
