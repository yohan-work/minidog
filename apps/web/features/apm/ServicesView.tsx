'use client';

import type { ServiceListResponse } from '@minidog/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { Metric, MetricGrid } from '@/components/observability/Metric';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatCount, formatLatency, formatPercent, formatRate } from '@/lib/format';
import { tracesHref } from '@/lib/links';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { LatencyTrendChart, LatencyTrendLegend, RequestsChart, RequestsLegend } from './RequestCharts';
import { errorRateTone, ServiceTable, ServiceTableSkeleton } from './ServiceTable';
import { TelemetrySetup } from './TelemetrySetup';
import styles from './Apm.module.scss';

export function ServicesView() {
  const range = useTimeRange();
  const { data, error, isLoading, updatedAt, refetch } = useApi<ServiceListResponse>(`/services?range=${range}`);
  const loading = !data;
  const seconds = data ? data.series.points.length * data.series.stepSeconds : 1;
  const tracesLink = <ButtonLink href={tracesHref({}, range)}>View traces</ButtonLink>;

  return (
    <>
      <PageHeader
        title="Services"
        actions={
          <ButtonLink href={withRange('/services/map', range)} size="sm">
            Service map
          </ButtonLink>
        }
      />
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      {!data && !isLoading ? (
        <ErrorState title="Unable to load services." description={error?.message} onRetry={refetch} />
      ) : data && data.services.length === 0 ? (
        <EmptyState
          title="No services yet"
          description="Services appear when an OpenTelemetry SDK sends traces. Point it at the collector:"
          action={<TelemetrySetup />}
        />
      ) : (
        <>
          <MetricGrid label="Summary">
            <Metric
              label="Services"
              loading={loading}
              value={data?.services.length}
              meta={data && `${data.services.filter((service) => service.health === 'healthy').length} healthy`}
            />
            <Metric
              label="Requests"
              loading={loading}
              value={formatCount(data?.totals.requests)}
              meta={data && formatRate(data.totals.requests / seconds)}
            />
            <Metric
              label="Error rate"
              loading={loading}
              value={formatPercent(data?.totals.errorRate)}
              tone={errorRateTone(data?.totals.errorRate)}
              meta={data && `${formatCount(data.totals.errors)} errors`}
            />
            <Metric
              label="P95 latency"
              loading={loading}
              value={formatLatency(data?.totals.p95Ms)}
              meta={data && `P99 ${formatLatency(data.totals.p99Ms)}`}
            />
          </MetricGrid>

          <Section title="Requests" actions={<RequestsLegend />}>
            {data ? (
              <RequestsChart series={data.series} subject="all services" emptyAction={tracesLink} />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section title="Latency" actions={<LatencyTrendLegend />}>
            {data ? (
              <LatencyTrendChart series={data.series} subject="all services" emptyAction={tracesLink} />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section
            title={
              <>
                Services {data && <span className={styles.count}>{data.services.length}</span>}
              </>
            }
            flush
          >
            {data ? <ServiceTable services={data.services} range={range} /> : <ServiceTableSkeleton />}
          </Section>
        </>
      )}
    </>
  );
}
