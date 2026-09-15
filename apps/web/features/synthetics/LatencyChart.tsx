'use client';

import type { Series } from '@minidog/types';
import { useMemo, type ReactNode } from 'react';
import { EmptyState } from '@/components/observability/States';
import { ChartLegend, TimeSeriesChart, type ChartSeries } from '@/components/observability/TimeSeriesChart';
import { formatLatency, formatLatencyAxis } from '@/lib/format';

export const LATENCY_LEGEND = [
  { label: 'P95', color: '--chart-primary' },
  { label: 'Average', color: '--chart-secondary', dashed: true },
] as const;

export function LatencyLegend() {
  return <ChartLegend series={LATENCY_LEGEND} />;
}

/** P95 and average response time of passing checks. */
export function LatencyChart({
  series,
  subject,
  emptyAction,
}: {
  series: Series;
  subject: string;
  emptyAction: ReactNode;
}) {
  const { timestamps, chartSeries, peak, hasData } = useMemo(() => {
    const points = series.points;
    const p95 = points.map((point) => point.p95LatencyMs);
    const avg = points.map((point) => point.avgLatencyMs);
    const values = p95.filter((value): value is number => value !== null);
    const lines: ChartSeries[] = [
      { ...LATENCY_LEGEND[0], values: p95 },
      { ...LATENCY_LEGEND[1], values: avg },
    ];
    return {
      timestamps: points.map((point) => point.t),
      chartSeries: lines,
      peak: values.length > 0 ? Math.max(...values) : null,
      hasData: values.length > 0,
    };
  }, [series]);

  if (!hasData) {
    return (
      <EmptyState
        fill="chart"
        title="No successful checks in this range"
        description="Response time is recorded for checks that pass."
        action={emptyAction}
      />
    );
  }

  return (
    <TimeSeriesChart
      timestamps={timestamps}
      series={chartSeries}
      formatValue={formatLatency}
      formatAxis={formatLatencyAxis}
      ariaLabel={`Response time of ${subject}. Peak P95 ${formatLatency(peak)}.`}
    />
  );
}
