'use client';

import type { ServiceResponse, ServiceSummary, TimeRange, TraceListResponse } from '@minidog/types';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { Metric, MetricGrid } from '@/components/observability/Metric';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatChange, formatCount, formatLatency, formatPercent, formatRate, formatRelative } from '@/lib/format';
import { logsHref, metricsHref, tracesHref } from '@/lib/links';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { hostHref } from '../infrastructure/host';
import { EndpointTable } from './EndpointTable';
import { LatencyTrendChart, LatencyTrendLegend, RequestsChart, RequestsLegend } from './RequestCharts';
import { errorRateTone, latencyTone } from './ServiceTable';
import { TraceTable, TraceTableSkeleton } from './TraceTable';
import styles from './Apm.module.scss';

export function ServiceDetailView({ service }: { service: string }) {
  const range = useTimeRange();
  const encoded = encodeURIComponent(service);
  const detail = useApi<ServiceResponse>(`/services/${encoded}?range=${range}`);
  const traces = useApi<TraceListResponse>(`/traces?range=${range}&service=${encoded}&limit=10`);
  const backHref = withRange('/services', range);
  const back = { href: backHref, label: 'Services' };
  const summary = detail.data?.service;

  if (detail.error?.status === 404) {
    return (
      <>
        <PageHeader title="Service not found" back={back} />
        <EmptyState
          title="No traces from this service in the last 14 days."
          description="Services are listed while they send server spans."
          action={<ButtonLink href={backHref}>Back to Services</ButtonLink>}
        />
      </>
    );
  }

  const tracesLink = <ButtonLink href={tracesHref({ service }, range)}>View traces</ButtonLink>;

  return (
    <>
      <PageHeader
        back={back}
        title={service}
        status={
          summary && (
            <>
              <StatusIndicator status={summary.health} />
              {summary.healthReason && <span className={styles.reason}>{summary.healthReason}</span>}
            </>
          )
        }
        meta={summary ? <ServiceMeta summary={summary} range={range} /> : detail.isLoading && <Skeleton width="calc(var(--space-16) * 3)" height="var(--text-secondary)" />}
        actions={
          <>
            <ButtonLink href={tracesHref({ service }, range)} size="sm">
              Traces
            </ButtonLink>
            <ButtonLink href={logsHref({ service }, range)} size="sm">
              Logs
            </ButtonLink>
            <ButtonLink href={metricsHref({ service }, range)} size="sm">
              Metrics
            </ButtonLink>
          </>
        }
      />
      <StaleNotice error={detail.data ? detail.error : undefined} updatedAt={detail.updatedAt} onRetry={detail.refetch} />

      {!detail.data && !detail.isLoading ? (
        <ErrorState title="Unable to load service." description={detail.error?.message} onRetry={detail.refetch} />
      ) : (
        <>
          <ServiceMetrics summary={summary} />

          <Section title="Latency" actions={<LatencyTrendLegend />}>
            {detail.data ? (
              <LatencyTrendChart series={detail.data.series} subject={service} emptyAction={tracesLink} />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section title="Requests" actions={<RequestsLegend />}>
            {detail.data ? (
              <RequestsChart series={detail.data.series} subject={service} emptyAction={tracesLink} />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section
            title={
              <>
                Endpoints {detail.data && <span className={styles.count}>{detail.data.endpoints.length}</span>}
              </>
            }
            actions={<span className={styles.note}>Slowest first</span>}
            flush
          >
            {!detail.data ? (
              <TraceTableSkeleton rows={3} />
            ) : detail.data.endpoints.length > 0 ? (
              <EndpointTable endpoints={detail.data.endpoints} range={range} />
            ) : (
              <EmptyState title="No endpoints in this range" description="Endpoints come from server span routes." action={tracesLink} />
            )}
          </Section>

          <Section
            title="Recent traces"
            actions={
              <ButtonLink href={tracesHref({ service }, range)} variant="ghost" size="sm">
                View all
              </ButtonLink>
            }
            flush
          >
            {traces.data ? (
              traces.data.traces.length > 0 ? (
                <TraceTable traces={traces.data.traces} range={range} label={`Recent traces of ${service}`} />
              ) : (
                <EmptyState title="No traces in this range" description="Try a longer time range." action={tracesLink} />
              )
            ) : traces.error ? (
              <ErrorState title="Unable to load traces." description={traces.error.message} onRetry={traces.refetch} />
            ) : (
              <TraceTableSkeleton rows={5} />
            )}
          </Section>
        </>
      )}
    </>
  );
}

function ServiceMeta({ summary, range }: { summary: ServiceSummary; range: TimeRange }) {
  const separator = (
    <span className={styles.metaSeparator} aria-hidden>
      ·
    </span>
  );
  return (
    <>
      {summary.hosts.map((host) => (
        <span key={host}>
          <Link href={hostHref(host, range)} className={`${styles.mono} ${styles.metaLink}`}>
            {host}
          </Link>
        </span>
      ))}
      {summary.hosts.length > 0 && separator}
      <span>last request {formatRelative(summary.lastSeenAt)}</span>
    </>
  );
}

function ServiceMetrics({ summary }: { summary: ServiceSummary | undefined }) {
  const loading = !summary;
  return (
    <MetricGrid label="Service summary">
      <Metric
        label="Requests"
        loading={loading}
        value={formatRate(summary?.requestsPerSecond)}
        meta={summary && `${formatCount(summary.requests)} in range`}
      />
      <Metric
        label="Error rate"
        loading={loading}
        value={formatPercent(summary?.errorRate)}
        tone={errorRateTone(summary?.errorRate)}
        meta={summary && `${formatCount(summary.errors)} errors`}
      />
      <Metric label="P50" loading={loading} value={formatLatency(summary?.p50Ms)} meta="median" />
      <Metric
        label="P95"
        loading={loading}
        value={formatLatency(summary?.p95Ms)}
        tone={latencyTone(summary?.p95Ms)}
        meta={summary?.p95Change != null ? `${formatChange(summary.p95Change)} vs previous` : 'no previous period'}
      />
      <Metric label="P99" loading={loading} value={formatLatency(summary?.p99Ms)} meta="tail" />
    </MetricGrid>
  );
}
