'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { formatDateTime } from '@/lib/format';
import styles from './TimeSeriesChart.module.scss';

export interface ChartSeries {
  label: string;
  values: readonly (number | null)[];
  /** CSS custom property holding the color, e.g. `--chart-primary`. */
  color: string;
  dashed?: boolean;
}

interface TimeSeriesChartProps {
  /** Epoch seconds. */
  timestamps: readonly number[];
  series: readonly ChartSeries[];
  /** Tooltip values. Pass a module-level function (stable identity). */
  formatValue: (value: number) => string;
  /** Y axis labels. Pass a module-level function (stable identity). */
  formatAxis?: (value: number) => string;
  /** Text alternative describing what the chart shows. */
  ariaLabel: string;
  height?: number;
  /** Fixed upper bound of the y axis, e.g. 1 for utilization. Defaults to the data maximum. */
  yMax?: number;
  /** Makes the chart selectable: dragging across it reports the window in epoch ms. */
  onSelectRange?: (fromMs: number, toMs: number) => void;
}

const DEFAULT_HEIGHT = 200;
const Y_AXIS_SIZE = 64;
const X_AXIS_SIZE = 28;
const TWO_DAYS = 2 * 24 * 60 * 60;
const HALF_HOUR = 30 * 60;

const tickTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const tickSeconds = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const tickDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/**
 * Each point starts a bucket that lasts until the next one, so a selection is
 * widened to whole buckets: a tight drag across a spike covers that minute.
 */
export function snapToBuckets(from: number, to: number, starts: ArrayLike<number>): [number, number] {
  if (starts.length < 2) return [from, to];
  const first = starts[0]!;
  const step = starts[1]! - first;
  if (!(step > 0)) return [from, to];
  return [first + Math.floor((from - first) / step) * step, first + (Math.floor((to - first) / step) + 1) * step];
}

interface Hover {
  index: number;
  left: number;
  flip: boolean;
}

/**
 * Minimal line chart: horizontal grid only, few axis labels, vertical
 * crosshair with a tooltip. Colors come from design tokens.
 */
export function TimeSeriesChart({
  timestamps,
  series,
  formatValue,
  formatAxis = formatValue,
  ariaLabel,
  height = DEFAULT_HEIGHT,
  yMax,
  onSelectRange,
}: TimeSeriesChartProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const plotHostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // Latest callback without rebuilding the plot when its identity changes.
  const selectRef = useRef(onSelectRange);
  useEffect(() => {
    selectRef.current = onSelectRange;
  });
  const selectable = onSelectRange !== undefined;

  const data = useMemo<uPlot.AlignedData>(
    () => [Array.from(timestamps), ...series.map((item) => Array.from(item.values))],
    [timestamps, series],
  );
  const dataRef = useRef(data);
  const configKey = series.map((item) => `${item.label}|${item.color}|${item.dashed ? 1 : 0}`).join(',');

  useEffect(() => {
    const root = rootRef.current;
    const host = plotHostRef.current;
    if (!root || !host) return;

    const css = getComputedStyle(root);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const font = `12px ${token('--font-mono')}`;
    const axisColor = token('--chart-axis');

    const options: uPlot.Options = {
      width: Math.max(host.clientWidth, 1),
      height,
      // Right padding keeps the last x label (centered on the edge) from being clipped.
      padding: [8, 32, 0, 0],
      legend: { show: false },
      cursor: {
        y: false,
        drag: { x: selectable, y: false, setScale: false },
        points: { size: 6, width: 0 },
      },
      scales: {
        x: { time: true },
        y: { range: (_plot, _min, max) => [0, yMax ?? (max > 0 ? max * 1.15 : 1)] },
      },
      axes: [
        {
          stroke: axisColor,
          font,
          size: X_AXIS_SIZE,
          // Clears the y-axis "0" label, which is centered on the plot's bottom edge.
          gap: 8,
          space: 96,
          ticks: { show: false },
          grid: { show: false },
          values: (plot, splits) => {
            const xs = plot.data[0];
            const span = xs.length > 1 ? xs[xs.length - 1]! - xs[0]! : 0;
            // Short windows (zoomed in from a chart) need seconds, or ticks repeat the same minute.
            const format = span > TWO_DAYS ? tickDate : span <= HALF_HOUR ? tickSeconds : tickTime;
            return splits.map((value) => format.format(value * 1000));
          },
        },
        {
          stroke: axisColor,
          font,
          size: Y_AXIS_SIZE,
          gap: 8,
          space: 40,
          ticks: { show: false },
          grid: { stroke: token('--chart-grid'), width: 1 },
          values: (_plot, splits) => splits.map((value) => formatAxis(value)),
        },
      ],
      series: [
        {},
        ...series.map((item) => ({
          label: item.label,
          stroke: token(item.color),
          width: 1.5,
          dash: item.dashed ? [4, 4] : undefined,
          points: { show: false },
          spanGaps: false,
        })),
      ],
      hooks: {
        setSelect: [
          (plot) => {
            const { left, width } = plot.select;
            // A click is not a selection.
            if (width < 4) return;
            const [fromSeconds, toSeconds] = snapToBuckets(plot.posToVal(left, 'x'), plot.posToVal(left + width, 'x'), plot.data[0]);
            plot.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            selectRef.current?.(fromSeconds * 1000, toSeconds * 1000);
          },
        ],
        setCursor: [
          (plot) => {
            const { idx, left } = plot.cursor;
            if (idx == null || left == null || left < 0) {
              setHover(null);
              return;
            }
            setHover({ index: idx, left: left + plot.over.offsetLeft, flip: left > plot.over.clientWidth / 2 });
          },
        ],
      },
    };

    const plot = new uPlot(options, dataRef.current, host);
    plotRef.current = plot;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) plot.setSize({ width: Math.max(Math.floor(entry.contentRect.width), 1), height });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // formatAxis is documented as stable; configKey captures series identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, height, yMax, selectable]);

  useEffect(() => {
    dataRef.current = data;
    plotRef.current?.setData(data);
  }, [data]);

  const hoveredTime = hover ? timestamps[hover.index] : undefined;

  return (
    <div ref={rootRef} className={styles.chart} role="img" aria-label={ariaLabel} data-selectable={selectable || undefined}>
      <div ref={plotHostRef} className={styles.plot} style={{ height }} />
      {hover && hoveredTime !== undefined && (
        <div className={styles.tooltip} style={{ left: hover.left }} data-flip={hover.flip || undefined} aria-hidden>
          <p className={styles.tooltipTime}>{formatDateTime(hoveredTime * 1000)}</p>
          {series.map((item) => {
            const value = item.values[hover.index];
            return (
              <p key={item.label} className={styles.tooltipRow}>
                <span className={styles.swatch} style={{ background: `var(${item.color})` }} data-dashed={item.dashed || undefined} />
                <span className={styles.tooltipLabel}>{item.label}</span>
                <span className={styles.tooltipValue}>{value == null ? 'No data' : formatValue(value)}</span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ChartLegend({ series }: { series: readonly Pick<ChartSeries, 'label' | 'color' | 'dashed'>[] }) {
  return (
    <ul className={styles.legend}>
      {series.map((item) => (
        <li key={item.label} className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: `var(${item.color})` }} data-dashed={item.dashed || undefined} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
