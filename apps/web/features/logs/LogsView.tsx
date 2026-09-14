'use client';

import type { LogListResponse } from '@minidog/types';
import { useMemo } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { FilterBar, FilterChip, FilterSelect, SearchField } from '@/components/layout/FilterBar';
import { LogList } from '@/components/observability/LogList';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { ChartLegend, TimeSeriesChart, type ChartSeries } from '@/components/observability/TimeSeriesChart';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatCount } from '@/lib/format';
import { toQuery, useQueryParams } from '@/lib/query-params';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { TelemetrySetup } from '../apm/TelemetrySetup';
import styles from './Logs.module.scss';

const LEVEL_OPTIONS = [
  { value: '', label: 'All levels' },
  { value: 'debug', label: 'Debug and above' },
  { value: 'info', label: 'Info and above' },
  { value: 'warn', label: 'Warn and above' },
  { value: 'error', label: 'Error and above' },
];

const VOLUME_SERIES = [
  { label: 'Logs', color: '--chart-secondary' },
  { label: 'Errors', color: '--status-error' },
] as const;

const PAGE = 200;
const MAX = 1000;

export function LogsView() {
  const range = useTimeRange();
  const { get, set } = useQueryParams();
  const filters = { service: get('service'), level: get('level'), q: get('q'), traceId: get('traceId') };
  const limit = Math.min(Number(get('limit')) || PAGE, MAX);
  const hasFilters = Object.values(filters).some(Boolean);

  const { data, error, isLoading, updatedAt, refetch } = useApi<LogListResponse>(`/logs${toQuery({ range, limit, ...filters })}`);

  const serviceOptions = [
    { value: '', label: 'All services' },
    ...(data?.services.map((service) => ({ value: service, label: service })) ?? []),
    ...(filters.service && !data?.services.includes(filters.service) ? [{ value: filters.service, label: filters.service }] : []),
  ];

  const clear = () => set({ service: null, level: null, q: null, traceId: null, limit: null });

  return (
    <>
      <PageHeader title="Logs" />
      <FilterBar trailing={data && (data.truncated ? `Latest ${formatCount(limit)}` : `${formatCount(data.logs.length)} records`)}>
        <FilterSelect label="Service" value={filters.service} options={serviceOptions} onChange={(service) => set({ service })} />
        <FilterSelect label="Level" value={filters.level} options={LEVEL_OPTIONS} onChange={(level) => set({ level })} />
        {filters.traceId && <FilterChip label="Trace" value={filters.traceId} onClear={() => set({ traceId: null })} />}
        <SearchField label="Search logs" value={filters.q} placeholder="Search logs…" onChange={(q) => set({ q })} />
      </FilterBar>
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      {!filters.traceId && (
        <Section title="Volume" actions={<ChartLegend series={VOLUME_SERIES} />}>
          {data ? <VolumeChart data={data} /> : <Skeleton height="var(--chart-height)" />}
        </Section>
      )}

      <Section title={filters.traceId ? 'Logs of this trace' : 'Records'} flush>
        {isLoading ? (
          <Skeleton height="calc(var(--row-height) * 8)" />
        ) : !data ? (
          <ErrorState title="Unable to query logs." description={error?.message} onRetry={refetch} />
        ) : data.logs.length > 0 ? (
          <>
            <LogList logs={data.logs} range={range} showTrace={!filters.traceId} />
            {data.truncated && limit < MAX && (
              <div className={styles.more}>
                <Button size="sm" onClick={() => set({ limit: String(limit + PAGE) })}>
                  Show {PAGE} more
                </Button>
              </div>
            )}
          </>
        ) : hasFilters ? (
          <EmptyState
            title="No logs match these filters"
            description="Widen the time range or remove a filter."
            action={
              <Button size="sm" onClick={clear}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No logs yet"
            description="Send logs with an OpenTelemetry SDK; records emitted inside a span link to their trace."
            action={<TelemetrySetup />}
          />
        )}
      </Section>
    </>
  );
}

function VolumeChart({ data }: { data: LogListResponse }) {
  const { timestamps, lines, total } = useMemo(() => {
    const points = data.series.points;
    const result: ChartSeries[] = [
      { ...VOLUME_SERIES[0], values: points.map((point) => point.total) },
      { ...VOLUME_SERIES[1], values: points.map((point) => point.errors) },
    ];
    return { timestamps: points.map((point) => point.t), lines: result, total: points.reduce((sum, point) => sum + point.total, 0) };
  }, [data]);

  if (total === 0) {
    return <p className={styles.empty}>No log records in this range.</p>;
  }
  return (
    <TimeSeriesChart
      timestamps={timestamps}
      series={lines}
      formatValue={formatCount}
      formatAxis={formatCount}
      height={120}
      ariaLabel={`Log volume: ${formatCount(total)} records in this range.`}
    />
  );
}
