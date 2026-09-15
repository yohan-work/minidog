'use client';

import type { RequestSeries } from '@minidog/types';
import { useMemo, type ReactNode } from 'react';
import { EmptyState } from '@/components/observability/States';
import { ChartLegend, TimeSeriesChart, type ChartMarker, type ChartSeries } from '@/components/observability/TimeSeriesChart';
import { formatCount, formatLatency, formatLatencyAxis } from '@/lib/format';

export const LATENCY_SERIES = [
  { label: 'P95', color: '--chart-primary' },
  { label: 'P99', color: '--chart-secondary', dashed: true },
  { label: 'P50', color: '--chart-secondary' },
] as const;

export const REQUEST_SERIES = [
  { label: 'Requests', color: '--chart-primary' },
  { label: 'Errors', color: '--status-error' },
] as const;

export function LatencyTrendLegend() {
  return <ChartLegend series={LATENCY_SERIES} />;
}

export function RequestsLegend() {
  return <ChartLegend series={REQUEST_SERIES} />;
}

interface ChartProps {
  series: RequestSeries;
  subject: string;
  emptyAction: ReactNode;
  /** Makes the chart selectable; receives the dragged window in epoch ms. */
  onSelectRange?: (fromMs: number, toMs: number) => void;
  /** Deployments drawn as vertical lines. */
  markers?: readonly ChartMarker[];
}

/** P50/P95/P99 of entry spans per bucket. */
export function LatencyTrendChart({ series, subject, emptyAction, onSelectRange, markers }: ChartProps) {
  const { timestamps, lines, peak } = useMemo(() => {
    const points = series.points;
    const p95 = points.map((point) => point.p95Ms);
    const values = p95.filter((value): value is number => value !== null);
    const result: ChartSeries[] = [
      { ...LATENCY_SERIES[0], values: p95 },
      { ...LATENCY_SERIES[1], values: points.map((point) => point.p99Ms) },
      { ...LATENCY_SERIES[2], values: points.map((point) => point.p50Ms) },
    ];
    return { timestamps: points.map((point) => point.t), lines: result, peak: values.length > 0 ? Math.max(...values) : null };
  }, [series]);

  if (peak === null) {
    return <EmptyState fill="chart" title="No requests in this range" description="Latency is measured on server spans." action={emptyAction} />;
  }
  return (
    <TimeSeriesChart
      timestamps={timestamps}
      series={lines}
      formatValue={formatLatency}
      formatAxis={formatLatencyAxis}
      ariaLabel={`Latency of ${subject}. Peak P95 ${formatLatency(peak)}.`}
      onSelectRange={onSelectRange}
      markers={markers}
    />
  );
}

/** Requests and errors per bucket. */
export function RequestsChart({ series, subject, emptyAction, onSelectRange, markers }: ChartProps) {
  const { timestamps, lines, total, errors } = useMemo(() => {
    const points = series.points;
    const result: ChartSeries[] = [
      { ...REQUEST_SERIES[0], values: points.map((point) => point.requests) },
      { ...REQUEST_SERIES[1], values: points.map((point) => point.errors) },
    ];
    return {
      timestamps: points.map((point) => point.t),
      lines: result,
      total: points.reduce((sum, point) => sum + point.requests, 0),
      errors: points.reduce((sum, point) => sum + point.errors, 0),
    };
  }, [series]);

  if (total === 0) {
    return <EmptyState fill="chart" title="No requests in this range" description="Throughput is counted from server spans." action={emptyAction} />;
  }
  return (
    <TimeSeriesChart
      timestamps={timestamps}
      series={lines}
      formatValue={formatCount}
      formatAxis={formatCount}
      ariaLabel={`Requests of ${subject}: ${formatCount(total)} requests, ${formatCount(errors)} errors.`}
      onSelectRange={onSelectRange}
      markers={markers}
    />
  );
}
