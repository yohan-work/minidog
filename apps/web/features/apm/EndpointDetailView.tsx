'use client';

import type { EndpointResponse, TraceListResponse } from '@minidog/types';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { Metric, MetricGrid } from '@/components/observability/Metric';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { drilldownLinks, SelectHint, SelectionBar, useChartSelection } from '@/components/observability/TimeSelection';
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatCount, formatLatency, formatPercent } from '@/lib/format';
import { serviceHref, tracesHref } from '@/lib/links';
import { toQuery, useQueryParams } from '@/lib/query-params';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { LatencyHistogram } from './LatencyHistogram';
import { LatencyTrendChart, LatencyTrendLegend, RequestsChart, RequestsLegend } from './RequestCharts';
import { errorRateTone, latencyTone } from './ServiceTable';
import { TraceTable, TraceTableSkeleton } from './TraceTable';
import styles from './Apm.module.scss';

/** One endpoint of a service: how fast it is, how that is distributed, and its slowest requests. */
export function EndpointDetailView({ service }: { service: string }) {
  const range = useTimeRange();
  const { get } = useQueryParams();
  const endpoint = get('e');
  const detail = useApi<EndpointResponse>(
    endpoint ? `/services/${encodeURIComponent(service)}/endpoint${toQuery({ range, endpoint })}` : null,
  );
  const slowest = useApi<TraceListResponse>(
    endpoint ? `/traces${toQuery({ range, service, endpoint, sort: 'slowest', limit: 10 })}` : null,
  );
  const chart = useChartSelection<'latency' | 'requests'>();
  const back = { href: serviceHref(service, range), label: service };
  const tracesLink = <ButtonLink href={tracesHref({ service, endpoint }, range)}>View traces</ButtonLink>;
  const summary = detail.data?.endpoint;

  if (!endpoint) {
    return (
      <>
        <PageHeader title="Endpoint" back={back} />
        <EmptyState
          title="No endpoint selected"
          description="Open an endpoint from its service page."
          action={<ButtonLink href={back.href}>Back to {service}</ButtonLink>}
        />
      </>
    );
  }

  if (detail.error?.status === 404) {
    return (
      <>
        <PageHeader title={endpoint} back={back} />
        <EmptyState
          title="No requests to this endpoint in this range"
          description="Choose a longer time range in the top bar."
          action={tracesLink}
        />
      </>
    );
  }

  const bar = (source: 'latency' | 'requests') => {
    const selection = chart.selectionFor(source);
    return (
      selection && (
        <SelectionBar
          selection={selection}
          links={drilldownLinks(selection, range, service, endpoint)}
          onClear={chart.clear}
        />
      )
    );
  };

  return (
    <>
      <PageHeader
        back={back}
        title={endpoint}
        meta={
          <>
            <span>Endpoint of</span>
            <Link href={serviceHref(service, range)} className={`${styles.mono} ${styles.metaLink}`}>
              {service}
            </Link>
          </>
        }
        actions={
          <ButtonLink href={tracesHref({ service, endpoint }, range)} size="sm">
            Traces
          </ButtonLink>
        }
      />
      <StaleNotice
        error={detail.data ? detail.error : undefined}
        updatedAt={detail.updatedAt}
        onRetry={detail.refetch}
      />

      {!detail.data && !detail.isLoading ? (
        <ErrorState title="Unable to load endpoint." description={detail.error?.message} onRetry={detail.refetch} />
      ) : (
        <>
          <MetricGrid label="Endpoint summary">
            <Metric label="Requests" loading={!summary} value={formatCount(summary?.requests)} meta="in range" />
            <Metric
              label="Error rate"
              loading={!summary}
              value={formatPercent(summary?.errorRate)}
              tone={errorRateTone(summary?.errorRate)}
              meta={summary && `${formatCount(summary.errors)} errors`}
            />
            <Metric label="P50" loading={!summary} value={formatLatency(summary?.p50Ms)} meta="median" />
            <Metric
              label="P95"
              loading={!summary}
              value={formatLatency(summary?.p95Ms)}
              tone={latencyTone(summary?.p95Ms)}
              meta="95% of requests are faster"
            />
            <Metric label="P99" loading={!summary} value={formatLatency(summary?.p99Ms)} meta="tail" />
          </MetricGrid>

          <Section
            title="Response time distribution"
            actions={<span className={styles.note}>Where the requests of the range fall</span>}
          >
            {detail.data && summary ? (
              <LatencyHistogram
                buckets={detail.data.histogram}
                percentiles={[
                  { label: 'P50', valueMs: summary.p50Ms },
                  { label: 'P95', valueMs: summary.p95Ms },
                  { label: 'P99', valueMs: summary.p99Ms },
                ]}
              />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section
            title="Latency"
            actions={
              <>
                <SelectHint />
                <LatencyTrendLegend />
              </>
            }
          >
            {bar('latency')}
            {detail.data ? (
              <LatencyTrendChart
                series={detail.data.series}
                subject={endpoint}
                emptyAction={tracesLink}
                onSelectRange={chart.select('latency')}
              />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section
            title="Requests"
            actions={
              <>
                <SelectHint />
                <RequestsLegend />
              </>
            }
          >
            {bar('requests')}
            {detail.data ? (
              <RequestsChart
                series={detail.data.series}
                subject={endpoint}
                emptyAction={tracesLink}
                onSelectRange={chart.select('requests')}
              />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section
            title="Slowest requests"
            actions={
              <ButtonLink
                href={withRange(`/traces${toQuery({ service, endpoint, sort: 'slowest' })}`, range)}
                variant="ghost"
                size="sm"
              >
                View all
              </ButtonLink>
            }
            flush
          >
            {slowest.data ? (
              slowest.data.traces.length > 0 ? (
                <TraceTable traces={slowest.data.traces} range={range} label={`Slowest requests to ${endpoint}`} />
              ) : (
                <EmptyState
                  title="No requests in this range"
                  description="Try a longer time range."
                  action={tracesLink}
                />
              )
            ) : slowest.error ? (
              <ErrorState
                title="Unable to load traces."
                description={slowest.error.message}
                onRetry={slowest.refetch}
              />
            ) : (
              <TraceTableSkeleton rows={5} />
            )}
          </Section>
        </>
      )}
    </>
  );
}
