'use client';

import { HOST_CURRENT_WINDOW_SECONDS, type HostResponse, type HostSeriesPoint, type HostSummary } from '@minidog/types';
import { useMemo } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { Metric, MetricGrid } from '@/components/observability/Metric';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { ChartLegend, TimeSeriesChart, type ChartSeries } from '@/components/observability/TimeSeriesChart';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  formatBytesRate,
  formatBytesRateAxis,
  formatRelative,
  formatUtilization,
  formatUtilizationAxis,
} from '@/lib/format';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { utilizationTone } from './host';
import styles from './Infrastructure.module.scss';

const CURRENT = `last ${HOST_CURRENT_WINDOW_SECONDS / 60} min`;

interface SeriesSpec {
  key: Exclude<keyof HostSeriesPoint, 't'>;
  label: string;
  color: string;
  dashed?: boolean;
}

const RESOURCE_SERIES: readonly SeriesSpec[] = [
  { key: 'cpu', label: 'CPU', color: '--chart-primary' },
  { key: 'memory', label: 'Memory', color: '--chart-secondary', dashed: true },
];
const DISK_SERIES: readonly SeriesSpec[] = [{ key: 'disk', label: 'Disk', color: '--chart-primary' }];
const NETWORK_SERIES: readonly SeriesSpec[] = [
  { key: 'networkRxBps', label: 'In', color: '--chart-primary' },
  { key: 'networkTxBps', label: 'Out', color: '--chart-secondary', dashed: true },
];

export function HostDetailView({ host }: { host: string }) {
  const range = useTimeRange();
  const { data, error, isLoading, updatedAt, refetch } = useApi<HostResponse>(
    `/hosts/${encodeURIComponent(host)}?range=${range}`,
  );
  const backHref = withRange('/infrastructure', range);
  const back = { href: backHref, label: 'Infrastructure' };

  if (error?.status === 404) {
    return (
      <>
        <PageHeader title="Host not found" back={back} />
        <EmptyState
          title="No data from this host in the last 7 days."
          description="Hosts are listed while their collector sends metrics."
          action={<ButtonLink href={backHref}>Back to Infrastructure</ButtonLink>}
        />
      </>
    );
  }

  const summary = data?.host;
  const points = data?.series.points;

  return (
    <>
      <PageHeader
        back={back}
        title={host}
        status={
          summary && (
            <>
              <StatusIndicator status={summary.health} />
              {summary.healthReason && <span className={styles.reason}>{summary.healthReason}</span>}
            </>
          )
        }
        meta={
          summary ? (
            <HostMeta summary={summary} />
          ) : (
            isLoading && <Skeleton width="calc(var(--space-16) * 3)" height="var(--text-secondary)" />
          )
        }
      />
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      {!data && !isLoading ? (
        <ErrorState title="Unable to load host." description={error?.message} onRetry={refetch} />
      ) : (
        <>
          <HostMetrics summary={summary} />

          <Section title="CPU and memory" actions={<ChartLegend series={RESOURCE_SERIES} />}>
            {points ? (
              <HostChart
                points={points}
                specs={RESOURCE_SERIES}
                formatValue={formatUtilization}
                formatAxis={formatUtilizationAxis}
                yMax={1}
                ariaLabel={`CPU and memory utilization of ${host}.`}
                emptyTitle="No CPU or memory data in this range"
                onRefresh={refetch}
              />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section title="Disk">
            {points ? (
              <HostChart
                points={points}
                specs={DISK_SERIES}
                formatValue={formatUtilization}
                formatAxis={formatUtilizationAxis}
                yMax={1}
                ariaLabel={`Utilization of the fullest filesystem of ${host}.`}
                emptyTitle="No filesystem data in this range"
                onRefresh={refetch}
              />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section title="Network" actions={<ChartLegend series={NETWORK_SERIES} />}>
            {points ? (
              <HostChart
                points={points}
                specs={NETWORK_SERIES}
                formatValue={formatBytesRate}
                formatAxis={formatBytesRateAxis}
                ariaLabel={`Network throughput of ${host}.`}
                emptyTitle="No network data in this range"
                onRefresh={refetch}
              />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>
        </>
      )}
    </>
  );
}

function HostMeta({ summary }: { summary: HostSummary }) {
  return (
    <>
      {summary.os && (
        <>
          <span className={styles.mono}>{summary.os}</span>
          <span className={styles.metaSeparator} aria-hidden>
            ·
          </span>
        </>
      )}
      <span>last seen {formatRelative(summary.lastSeenAt)}</span>
    </>
  );
}

function HostMetrics({ summary }: { summary: HostSummary | undefined }) {
  const loading = !summary;
  return (
    <MetricGrid label="Host summary">
      <Metric
        label="CPU"
        loading={loading}
        value={formatUtilization(summary?.cpu)}
        tone={utilizationTone(summary?.cpu)}
        meta={`avg, ${CURRENT}`}
      />
      <Metric
        label="Memory"
        loading={loading}
        value={formatUtilization(summary?.memory)}
        tone={utilizationTone(summary?.memory)}
        meta={`used, ${CURRENT}`}
      />
      <Metric
        label="Disk"
        loading={loading}
        value={formatUtilization(summary?.disk)}
        tone={utilizationTone(summary?.disk)}
        meta={summary?.diskMountpoint ? `fullest: ${summary.diskMountpoint}` : 'fullest filesystem'}
      />
      <Metric label="Network in" loading={loading} value={formatBytesRate(summary?.networkRxBps)} meta={CURRENT} />
      <Metric label="Network out" loading={loading} value={formatBytesRate(summary?.networkTxBps)} meta={CURRENT} />
    </MetricGrid>
  );
}

interface HostChartProps {
  points: readonly HostSeriesPoint[];
  specs: readonly SeriesSpec[];
  formatValue: (value: number) => string;
  formatAxis: (value: number) => string;
  yMax?: number;
  ariaLabel: string;
  emptyTitle: string;
  onRefresh: () => void;
}

function HostChart({ points, specs, formatValue, formatAxis, yMax, ariaLabel, emptyTitle, onRefresh }: HostChartProps) {
  const { timestamps, series, hasData } = useMemo(() => {
    const lines: ChartSeries[] = specs.map((spec) => ({
      label: spec.label,
      color: spec.color,
      ...(spec.dashed ? { dashed: true } : {}),
      values: points.map((point) => point[spec.key]),
    }));
    return {
      timestamps: points.map((point) => point.t),
      series: lines,
      hasData: lines.some((line) => line.values.some((value) => value !== null)),
    };
  }, [points, specs]);

  if (!hasData) {
    return (
      <EmptyState
        fill="chart"
        title={emptyTitle}
        description="The collector sends host metrics every 15 seconds."
        action={
          <Button size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        }
      />
    );
  }

  return (
    <TimeSeriesChart
      timestamps={timestamps}
      series={series}
      formatValue={formatValue}
      formatAxis={formatAxis}
      ariaLabel={ariaLabel}
      {...(yMax === undefined ? {} : { yMax })}
    />
  );
}
