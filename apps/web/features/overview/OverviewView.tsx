'use client';

import { TIME_RANGES, type MonitorWithSummary, type OverviewResponse, type TimeRange } from '@minidog/types';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { AvailabilityBar } from '@/components/observability/AvailabilityBar';
import { Metric, MetricGrid } from '@/components/observability/Metric';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatCount, formatLatency, formatPercent } from '@/lib/format';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { LatencyChart, LatencyLegend } from '../synthetics/LatencyChart';
import { MonitorTable, MonitorTableSkeleton } from '../synthetics/MonitorTable';
import { ResultsNotice } from '../synthetics/ResultsNotice';
import styles from './Overview.module.scss';

const SEVERITY: Record<string, number> = { critical: 0, degraded: 1 };

export function OverviewView() {
  const range = useTimeRange();
  const { data, error, isLoading, updatedAt, refetch } = useApi<OverviewResponse>(`/overview?range=${range}`);
  const newHref = withRange('/synthetics/new', range);

  return (
    <>
      <PageHeader title="Overview" />
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />
      <ResultsNotice error={data?.resultsError} onRetry={refetch} />

      {!data && !isLoading ? (
        <ErrorState title="Unable to load overview." description={error?.message} onRetry={refetch} />
      ) : data && data.counts.total === 0 ? (
        <EmptyState
          title="No monitors yet"
          description="Overview summarizes availability and response time across your services. Add a URL to start collecting checks."
          action={
            <ButtonLink href={newHref} variant="primary">
              New monitor
            </ButtonLink>
          }
        />
      ) : (
        <OverviewContent data={data} range={range} />
      )}
    </>
  );
}

function OverviewContent({ data, range }: { data: OverviewResponse | undefined; range: TimeRange }) {
  const loading = !data;
  const attention = (data?.monitors ?? [])
    .filter((monitor) => monitor.enabled && monitor.summary.health in SEVERITY)
    .sort((a, b) => SEVERITY[a.summary.health]! - SEVERITY[b.summary.health]!);
  const hasCritical = attention.some((monitor) => monitor.summary.health === 'critical');
  const rangeLabel = TIME_RANGES[range].label.toLowerCase();

  return (
    <>
      <MetricGrid label="Summary">
        <Metric label="Monitors" loading={loading} value={data?.counts.total} meta={data && countsMeta(data.counts)} />
        <Metric
          label="Availability"
          loading={loading}
          value={formatPercent(data?.availability)}
          tone={data?.availability != null && data.availability < 1 ? 'warning' : undefined}
          meta={data && `${formatCount(data.checks)} checks, ${rangeLabel}`}
        />
        <Metric
          label="Failed checks"
          loading={loading}
          value={formatCount(data?.failures)}
          tone={data && data.failures > 0 ? 'error' : undefined}
          meta={rangeLabel}
        />
        <Metric
          label="P95 latency"
          loading={loading}
          value={formatLatency(data?.p95LatencyMs)}
          meta={data && `avg ${formatLatency(data.avgLatencyMs)}`}
        />
        <Metric
          label="Needs attention"
          loading={loading}
          value={attention.length}
          tone={hasCritical ? 'error' : attention.length > 0 ? 'warning' : undefined}
          meta={attention.length > 0 ? 'critical or degraded' : 'all monitors passing'}
        />
      </MetricGrid>

      {attention.length > 0 && <AttentionSection monitors={attention} range={range} />}

      <Section title="Availability">
        {data ? <AvailabilityBar points={data.series.points} /> : <Skeleton height="var(--bar-height)" />}
      </Section>

      <Section title="Response time" actions={<LatencyLegend />}>
        {data ? (
          <LatencyChart
            series={data.series}
            subject="all monitors"
            emptyAction={<ButtonLink href={withRange('/synthetics', range)}>View monitors</ButtonLink>}
          />
        ) : (
          <Skeleton height="var(--chart-height)" />
        )}
      </Section>

      <Section
        title="Monitors"
        flush
        actions={
          <ButtonLink href={withRange('/synthetics', range)} variant="ghost" size="sm">
            View all
          </ButtonLink>
        }
      >
        {data ? <MonitorTable monitors={data.monitors} range={range} /> : <MonitorTableSkeleton />}
      </Section>
    </>
  );
}

function countsMeta(counts: OverviewResponse['counts']): string {
  const parts = (['healthy', 'degraded', 'critical', 'unknown', 'paused'] as const)
    .filter((key) => counts[key] > 0)
    .map((key) => `${counts[key]} ${key}`);
  return parts.join(' · ');
}

/** Signal over data: the monitors that need a look, with the likely cause. */
function AttentionSection({ monitors, range }: { monitors: readonly MonitorWithSummary[]; range: TimeRange }) {
  const title = `${monitors.length} monitor${monitors.length === 1 ? ' needs' : 's need'} attention`;
  return (
    <Section title={title}>
      <ul className={styles.attention}>
        {monitors.map((monitor) => {
          const href = withRange(`/synthetics/${monitor.id}`, range);
          return (
            <li key={monitor.id} className={styles.attentionItem}>
              <StatusIndicator status={monitor.summary.health} />
              <Link href={href} className={styles.attentionName}>
                {monitor.name}
              </Link>
              <span className={styles.attentionReason}>{monitor.summary.healthReason}</span>
              {monitor.summary.lastStatus === 'down' && monitor.summary.lastError && (
                <span className={styles.attentionError}>{monitor.summary.lastError}</span>
              )}
              <Link href={href} className={styles.attentionLink}>
                View monitor
                <Icon name="arrow-right" size={14} />
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
