'use client';

import type { LogListResponse } from '@minidog/types';
import { useMemo } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { FilterBar, FilterChip, FilterSelect, SearchField } from '@/components/layout/FilterBar';
import { LogList } from '@/components/observability/LogList';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { ChartLegend, TimeSeriesChart, type ChartSeries } from '@/components/observability/TimeSeriesChart';
import { formatWindow, parseWindow, SelectHint, windowParams } from '@/components/observability/TimeSelection';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatCount } from '@/lib/format';
import { toQuery, useQueryParams } from '@/lib/query-params';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { TelemetrySetup } from '../apm/TelemetrySetup';
import { LiveTail } from './LiveTail';
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
  // When the trace was seen, from the screen that linked here; only meaningful with a trace id.
  const at = filters.traceId && /^\d+$/.test(get('at') ?? '') ? get('at') : undefined;
  const window = parseWindow(get('from'), get('to'));
  const limit = Math.min(Number(get('limit')) || PAGE, MAX);
  const hasFilters = Object.values(filters).some(Boolean) || window !== null;
  const live = get('live') === '1';

  // Keeps loading while live tail runs: it feeds the service filter, and the
  // records are ready when live tail stops.
  const { data, error, isLoading, updatedAt, refetch } = useApi<LogListResponse>(
    `/logs${toQuery({ range, limit, ...filters, at, ...(window ? windowParams(window) : {}) })}`,
  );

  const serviceOptions = [
    { value: '', label: 'All services' },
    ...(data?.services.map((service) => ({ value: service, label: service })) ?? []),
    ...(filters.service && !data?.services.includes(filters.service)
      ? [{ value: filters.service, label: filters.service }]
      : []),
  ];

  const clear = () =>
    set({ service: null, level: null, q: null, traceId: null, at: null, limit: null, from: null, to: null });
  // Dragging on the volume chart narrows the records to that window.
  const selectWindow = (fromMs: number, toMs: number) => set({ ...windowParams({ fromMs, toMs }), limit: null });
  // Live tail follows new records, so a fixed window, a trace or paging do not apply.
  const toggleLive = () =>
    set(live ? { live: null } : { live: '1', from: null, to: null, traceId: null, at: null, limit: null });

  return (
    <>
      <PageHeader
        title="Logs"
        actions={
          <Button size="sm" aria-pressed={live} onClick={toggleLive}>
            {live ? 'Stop live tail' : 'Live tail'}
          </Button>
        }
      />
      <FilterBar
        trailing={
          !live &&
          data &&
          (data.truncated ? `Latest ${formatCount(limit)}` : `${formatCount(data.logs.length)} records`)
        }
      >
        <FilterSelect
          label="Service"
          value={filters.service}
          options={serviceOptions}
          onChange={(service) => set({ service })}
        />
        <FilterSelect
          label="Level"
          value={filters.level}
          options={LEVEL_OPTIONS}
          onChange={(level) => set({ level })}
        />
        {window && !filters.traceId && (
          <FilterChip label="Window" value={formatWindow(window)} onClear={() => set({ from: null, to: null })} />
        )}
        {filters.traceId && (
          <FilterChip label="Trace" value={filters.traceId} onClear={() => set({ traceId: null, at: null })} />
        )}
        <SearchField label="Search logs" value={filters.q} placeholder="Search logs…" onChange={(q) => set({ q })} />
      </FilterBar>
      {live ? (
        <LiveTail
          filters={{ service: filters.service, level: filters.level, q: filters.q }}
          range={range}
          emptyAction={
            hasFilters ? (
              <Button size="sm" onClick={clear}>
                Clear filters
              </Button>
            ) : (
              <TelemetrySetup />
            )
          }
        />
      ) : (
        <>
          <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

          {!filters.traceId && (
            <Section
              title="Volume"
              actions={
                <>
                  <SelectHint />
                  <ChartLegend series={VOLUME_SERIES} />
                </>
              }
            >
              {data ? (
                <VolumeChart data={data} onSelectRange={selectWindow} />
              ) : (
                <Skeleton height="var(--chart-height)" />
              )}
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
      )}
    </>
  );
}

function VolumeChart({
  data,
  onSelectRange,
}: {
  data: LogListResponse;
  onSelectRange: (fromMs: number, toMs: number) => void;
}) {
  const { timestamps, lines, total } = useMemo(() => {
    const points = data.series.points;
    const result: ChartSeries[] = [
      { ...VOLUME_SERIES[0], values: points.map((point) => point.total) },
      { ...VOLUME_SERIES[1], values: points.map((point) => point.errors) },
    ];
    return {
      timestamps: points.map((point) => point.t),
      lines: result,
      total: points.reduce((sum, point) => sum + point.total, 0),
    };
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
      onSelectRange={onSelectRange}
    />
  );
}
