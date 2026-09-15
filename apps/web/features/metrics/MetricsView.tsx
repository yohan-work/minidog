'use client';

import {
  METRIC_AGGREGATIONS,
  type MetricAggregation,
  type MetricCatalogEntry,
  type MetricCatalogResponse,
  type MetricQueryResponse,
} from '@minidog/types';
import { useCallback, useMemo } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { FilterBar, FilterSelect } from '@/components/layout/FilterBar';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { ChartLegend, TimeSeriesChart, type ChartSeries } from '@/components/observability/TimeSeriesChart';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableHead, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { formatMetricValue } from '@/lib/format';
import { toQuery, useQueryParams } from '@/lib/query-params';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { AddToDashboard } from '../dashboards/AddToDashboard';
import styles from './Metrics.module.scss';

export const AGGREGATION_LABELS: Record<MetricAggregation, string> = {
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
  sum: 'Sum',
  p95: 'P95',
  rate: 'Rate per second',
};

const COLUMNS = [
  { label: 'Series' },
  { label: 'Last', align: 'end' },
  { label: 'Average', align: 'end' },
  { label: 'Max', align: 'end' },
] as const satisfies readonly ColumnSpec[];

/** Delta counters read best as a rate; everything else as an average. */
export function defaultAggregation(entry: MetricCatalogEntry | undefined): MetricAggregation {
  return entry?.type === 'sum' && entry.temporality === 'delta' ? 'rate' : 'avg';
}

export const seriesColor = (index: number) => `--chart-series-${index + 1}`;

/** Start on a metric that answers a question; counts of CPUs do not. */
const PREFERRED_METRICS = ['system.cpu.utilization', 'system.memory.utilization', 'system.network.io'];

function defaultMetric(entries: readonly MetricCatalogEntry[]): string {
  const names = new Set(entries.map((entry) => entry.name));
  return PREFERRED_METRICS.find((name) => names.has(name)) ?? entries[0]?.name ?? '';
}

export function MetricsView() {
  const range = useTimeRange();
  const { get, set } = useQueryParams();
  const catalog = useApi<MetricCatalogResponse>(`/metrics/catalog?range=${range}`, 60_000);

  const entries = catalog.data?.metrics ?? [];
  const metric = get('metric') || defaultMetric(entries);
  const entry = entries.find((item) => item.name === metric);
  const aggregation = (METRIC_AGGREGATIONS as readonly string[]).includes(get('aggregation'))
    ? (get('aggregation') as MetricAggregation)
    : defaultAggregation(entry);
  const filters = { service: get('service'), host: get('host'), groupBy: get('groupBy') };

  const result = useApi<MetricQueryResponse>(
    metric ? `/metrics/query${toQuery({ range, metric, aggregation, ...filters })}` : null,
  );

  const choose = useCallback(
    (name: string) => set({ metric: name, aggregation: null, service: null, host: null, groupBy: null }),
    [set],
  );

  const option = (value: string, label = value) => ({ value, label });
  const metricOptions = entries.length > 0 ? entries.map((item) => option(item.name)) : [option(metric || '', metric || 'No metrics')];
  const withCurrent = (values: readonly string[], current: string) => (current && !values.includes(current) ? [...values, current] : values);
  const serviceOptions = [option('', 'All services'), ...withCurrent(entry?.services ?? [], filters.service).map((value) => option(value))];
  const hostOptions = [option('', 'All hosts'), ...withCurrent(entry?.hosts ?? [], filters.host).map((value) => option(value))];
  const groupOptions = [
    option('', 'No grouping'),
    option('service', 'By service'),
    option('host', 'By host'),
    ...(entry?.attributeKeys ?? []).map((key) => option(`attr:${key}`, `By ${key}`)),
  ];

  if (!catalog.data && !catalog.isLoading) {
    return (
      <>
        <PageHeader title="Metrics" />
        <ErrorState title="Unable to load metrics." description={catalog.error?.message} onRetry={catalog.refetch} />
      </>
    );
  }

  if (catalog.data && entries.length === 0 && !get('metric')) {
    return (
      <>
        <PageHeader title="Metrics" />
        <EmptyState
          title="No metrics yet"
          description="Metrics arrive from the collector's hostmetrics receiver and from OpenTelemetry SDK meters (gauges and sums)."
          action={
            <Button size="sm" onClick={catalog.refetch}>
              Refresh
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Metrics"
        actions={
          metric ? (
            <AddToDashboard
              widget={{ kind: 'metric', metric, aggregation, service: filters.service || '', host: filters.host || '', groupBy: filters.groupBy || '', size: 'half', title: '' }}
            />
          ) : undefined
        }
      />
      <FilterBar trailing={entry && <span className={styles.unit}>{entry.type}{entry.temporality && ` · ${entry.temporality}`}{entry.unit && ` · ${entry.unit}`}</span>}>
        <FilterSelect label="Metric" value={metric} options={metricOptions} onChange={choose} />
        <FilterSelect
          label="Aggregation"
          value={aggregation}
          options={METRIC_AGGREGATIONS.map((value) => option(value, AGGREGATION_LABELS[value]))}
          onChange={(value) => set({ aggregation: value })}
        />
        <FilterSelect label="Service" value={filters.service} options={serviceOptions} onChange={(service) => set({ service })} />
        <FilterSelect label="Host" value={filters.host} options={hostOptions} onChange={(host) => set({ host })} />
        <FilterSelect label="Group by" value={filters.groupBy} options={groupOptions} onChange={(groupBy) => set({ groupBy })} />
      </FilterBar>
      <StaleNotice error={result.data ? result.error : undefined} updatedAt={result.updatedAt} onRetry={result.refetch} />

      {!result.data && result.error ? (
        <ErrorState title="Unable to query metric." description={result.error.message} onRetry={result.refetch} />
      ) : (
        <MetricResult data={result.data} onRetry={result.refetch} />
      )}
    </>
  );
}

function MetricResult({ data, onRetry }: { data: MetricQueryResponse | undefined; onRetry: () => void }) {
  const perSecond = data?.aggregation === 'rate';
  const format = useCallback((value: number) => formatMetricValue(value, data?.unit ?? '', perSecond), [data?.unit, perSecond]);

  const { series, hasData, rows } = useMemo(() => {
    const groups = data?.groups ?? [];
    return {
      series: groups.map<ChartSeries>((group, index) => ({ label: group.key || data?.metric || 'value', color: seriesColor(index), values: group.values })),
      hasData: groups.some((group) => group.values.some((value) => value !== null)),
      rows: groups.map((group, index) => {
        const values = group.values.filter((value): value is number => value !== null);
        return {
          key: group.key || data?.metric || 'value',
          color: seriesColor(index),
          last: values.at(-1) ?? null,
          avg: values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
          max: values.length > 0 ? Math.max(...values) : null,
        };
      }),
    };
  }, [data]);

  if (!data) {
    return (
      <Section title="Chart">
        <Skeleton height="var(--chart-height)" />
      </Section>
    );
  }

  const title = `${AGGREGATION_LABELS[data.aggregation]} of ${data.metric}`;
  return (
    <>
      <Section title={title} actions={series.length > 1 ? <ChartLegend series={series} /> : undefined}>
        {hasData ? (
          <TimeSeriesChart
            key={`${data.metric}|${data.aggregation}|${data.unit}`}
            timestamps={data.timestamps}
            series={series}
            formatValue={format}
            formatAxis={format}
            ariaLabel={`${title}, ${series.length} series.`}
          />
        ) : (
          <EmptyState
            fill="chart"
            title="No data points in this range"
            description="Try a longer time range or remove a filter."
            action={
              <Button size="sm" onClick={onRetry}>
                Refresh
              </Button>
            }
          />
        )}
      </Section>
      {hasData && (
        <Section
          title="Series"
          actions={data.omittedGroups > 0 ? <span className={styles.unit}>{data.omittedGroups} smaller series not shown</span> : undefined}
          flush
        >
          <Table aria-label="Series summary">
            <TableHead columns={COLUMNS} />
            <tbody>
              {rows.map((row) => (
                <Tr key={row.key}>
                  <Td>
                    <span className={styles.series}>
                      <span className={styles.swatch} style={{ background: `var(${row.color})` }} aria-hidden />
                      {row.key}
                    </span>
                  </Td>
                  <Td align="end" mono>
                    {format(row.last ?? Number.NaN)}
                  </Td>
                  <Td align="end" mono>
                    {format(row.avg ?? Number.NaN)}
                  </Td>
                  <Td align="end" mono>
                    {format(row.max ?? Number.NaN)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
    </>
  );
}
