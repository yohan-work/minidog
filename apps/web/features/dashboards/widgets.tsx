'use client';

import type {
  DashboardWidget,
  MetricQueryResponse,
  MetricWidget,
  NewDashboardWidget,
  Series,
  ServiceResponse,
  ServiceWidget,
  SyntheticWidget,
  TimeRange,
} from '@minidog/types';
import Link from 'next/link';
import { useCallback, useMemo, type ReactNode } from 'react';
import { AvailabilityBar } from '@/components/observability/AvailabilityBar';
import { EmptyState, ErrorState } from '@/components/observability/States';
import { ChartLegend, TimeSeriesChart, type ChartSeries } from '@/components/observability/TimeSeriesChart';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMetricValue } from '@/lib/format';
import { toQuery } from '@/lib/query-params';
import { withRange } from '@/lib/range-href';
import { useApi } from '@/lib/use-api';
import { LatencyTrendChart, RequestsChart } from '../apm/RequestCharts';
import { AGGREGATION_LABELS, seriesColor } from '../metrics/MetricsView';
import { LatencyChart } from '../synthetics/LatencyChart';
import styles from './Dashboards.module.scss';

const CHART_HEIGHT = 180;

/** What a widget shows when it has no title of its own. */
export function defaultTitle(widget: NewDashboardWidget | DashboardWidget): string {
  switch (widget.kind) {
    case 'metric': {
      const filters = [widget.service, widget.host].filter(Boolean).join(', ');
      return `${AGGREGATION_LABELS[widget.aggregation]} of ${widget.metric}${filters ? ` · ${filters}` : ''}`;
    }
    case 'service':
      return `${widget.service} · ${widget.chart === 'requests' ? 'Requests' : 'Latency'}`;
    case 'synthetic':
      return 'Synthetic monitor';
  }
}

/** The page the widget's data comes from. */
export function widgetHref(widget: DashboardWidget, range: TimeRange): string {
  switch (widget.kind) {
    case 'metric':
      return withRange(
        `/metrics${toQuery({ metric: widget.metric, aggregation: widget.aggregation, service: widget.service, host: widget.host, groupBy: widget.groupBy })}`,
        range,
      );
    case 'service':
      return withRange(`/services/${encodeURIComponent(widget.service)}`, range);
    case 'synthetic':
      return withRange(`/synthetics/${widget.monitorId}`, range);
  }
}

export function WidgetFrame({
  widget,
  range,
  controls,
}: {
  widget: DashboardWidget;
  range: TimeRange;
  controls?: ReactNode;
}) {
  const title = widget.title || defaultTitle(widget);
  return (
    <article className={styles.widget} data-size={widget.size} aria-label={title}>
      <header className={styles.widgetHead}>
        <h2 className={styles.widgetTitle}>
          <Link href={widgetHref(widget, range)} title={title}>
            {title}
          </Link>
        </h2>
        {controls && <div className={styles.controls}>{controls}</div>}
      </header>
      <div className={styles.widgetBody}>
        {widget.kind === 'metric' ? (
          <MetricWidgetView widget={widget} range={range} />
        ) : widget.kind === 'service' ? (
          <ServiceWidgetView widget={widget} range={range} />
        ) : (
          <SyntheticWidgetView widget={widget} range={range} />
        )}
      </div>
    </article>
  );
}

function Loading() {
  return <Skeleton height={`${CHART_HEIGHT}px`} />;
}

function MetricWidgetView({ widget, range }: { widget: MetricWidget; range: TimeRange }) {
  const { data, error, refetch } = useApi<MetricQueryResponse>(
    `/metrics/query${toQuery({ range, metric: widget.metric, aggregation: widget.aggregation, service: widget.service, host: widget.host, groupBy: widget.groupBy })}`,
  );
  const perSecond = widget.aggregation === 'rate';
  const format = useCallback(
    (value: number) => formatMetricValue(value, data?.unit ?? '', perSecond),
    [data?.unit, perSecond],
  );
  const series = useMemo(
    () =>
      (data?.groups ?? []).map<ChartSeries>((group, index) => ({
        label: group.key || widget.metric,
        color: seriesColor(index),
        values: group.values,
      })),
    [data, widget.metric],
  );

  if (!data)
    return error ? (
      <ErrorState fill="chart" title="Unable to query metric." description={error.message} onRetry={refetch} />
    ) : (
      <Loading />
    );
  if (!series.some((item) => item.values.some((value) => value !== null))) {
    return (
      <EmptyState
        fill="chart"
        title="No data points in this range"
        description="Try a longer time range."
        action={<Refresh onClick={refetch} />}
      />
    );
  }
  return (
    <>
      <TimeSeriesChart
        timestamps={data.timestamps}
        series={series}
        formatValue={format}
        formatAxis={format}
        height={CHART_HEIGHT}
        ariaLabel={`${defaultTitle(widget)}, ${series.length} series.`}
      />
      {series.length > 1 && <ChartLegend series={series} />}
    </>
  );
}

function ServiceWidgetView({ widget, range }: { widget: ServiceWidget; range: TimeRange }) {
  const { data, error, refetch } = useApi<ServiceResponse>(
    `/services/${encodeURIComponent(widget.service)}${toQuery({ range })}`,
  );
  if (!data)
    return error ? (
      <ErrorState fill="chart" title="Unable to load service." description={error.message} onRetry={refetch} />
    ) : (
      <Loading />
    );
  const Chart = widget.chart === 'requests' ? RequestsChart : LatencyTrendChart;
  return <Chart series={data.series} subject={widget.service} emptyAction={<Refresh onClick={refetch} />} />;
}

function SyntheticWidgetView({ widget, range }: { widget: SyntheticWidget; range: TimeRange }) {
  const { data, error, refetch } = useApi<Series>(`/monitors/${widget.monitorId}/series${toQuery({ range })}`);
  if (!data)
    return error ? (
      <ErrorState fill="chart" title="Unable to load monitor." description={error.message} onRetry={refetch} />
    ) : (
      <Loading />
    );
  return (
    <>
      <LatencyChart
        series={data}
        subject={widget.title || 'this monitor'}
        emptyAction={<Refresh onClick={refetch} />}
      />
      <AvailabilityBar points={data.points} stepSeconds={data.stepSeconds} gaps={data.gaps} />
    </>
  );
}

function Refresh({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick}>
      Refresh
    </Button>
  );
}
