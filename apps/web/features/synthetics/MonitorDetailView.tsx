'use client';

import type { MonitorChecksResponse, MonitorResponse, MonitorWithSummary, RunCheckResponse, Series } from '@minidog/types';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { AvailabilityBar } from '@/components/observability/AvailabilityBar';
import { Metric, MetricGrid } from '@/components/observability/Metric';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { monitorStatus, StatusIndicator } from '@/components/observability/StatusIndicator';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import {
  daysUntil,
  formatCount,
  formatDate,
  formatDaysUntil,
  formatInterval,
  formatLatency,
  formatPercent,
  formatRelative,
} from '@/lib/format';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { LatencyChart, LatencyLegend } from './LatencyChart';
import { SSL_WARNING_DAYS } from './MonitorTable';
import { RecentChecksSkeleton, RecentChecksTable } from './RecentChecksTable';
import { ResultsNotice } from './ResultsNotice';
import styles from './Synthetics.module.scss';

type PendingAction = 'run' | 'toggle' | 'delete';

export function MonitorDetailView({ id }: { id: string }) {
  const range = useTimeRange();
  const router = useRouter();
  const monitorQuery = useApi<MonitorResponse>(`/monitors/${id}?range=${range}`);
  const seriesQuery = useApi<Series>(`/monitors/${id}/series?range=${range}`);
  const checksQuery = useApi<MonitorChecksResponse>(`/monitors/${id}/checks?limit=50`);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const backHref = withRange('/synthetics', range);
  const monitor = monitorQuery.data?.monitor;

  if (monitorQuery.error?.status === 404) {
    return (
      <>
        <PageHeader title="Monitor not found" back={{ href: backHref, label: 'Synthetics' }} />
        <EmptyState
          title="This monitor does not exist."
          description="It may have been deleted."
          action={<ButtonLink href={backHref}>Back to Synthetics</ButtonLink>}
        />
      </>
    );
  }

  const refreshAll = () => {
    monitorQuery.refetch();
    seriesQuery.refetch();
    checksQuery.refetch();
  };

  const perform = async (kind: PendingAction, action: () => Promise<void>) => {
    setPending(kind);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(toApiClientError(error).message);
    } finally {
      setPending(null);
    }
  };

  const runCheck = () =>
    perform('run', async () => {
      const result = await apiFetch<RunCheckResponse>(`/monitors/${id}/run`, { method: 'POST' });
      if (!result.persisted) setActionError('The check ran but its result could not be saved. ClickHouse did not respond.');
      refreshAll();
    });

  const toggleEnabled = (current: MonitorWithSummary) =>
    perform('toggle', async () => {
      await apiFetch(`/monitors/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !current.enabled }) });
      refreshAll();
    });

  const remove = () =>
    perform('delete', async () => {
      await apiFetch(`/monitors/${id}`, { method: 'DELETE' });
      router.push(backHref);
    });

  const runButton = (
    <Button size="sm" loading={pending === 'run'} disabled={pending !== null} onClick={runCheck}>
      Run check
    </Button>
  );

  return (
    <>
      <PageHeader
        back={{ href: backHref, label: 'Synthetics' }}
        title={monitor ? monitor.name : <Skeleton width="calc(var(--space-16) * 3)" height="var(--text-page)" />}
        status={
          monitor && (
            <>
              <StatusIndicator status={monitorStatus(monitor)} />
              {monitor.summary.healthReason && monitor.enabled && (
                <span className={styles.reason}>{monitor.summary.healthReason}</span>
              )}
            </>
          )
        }
        meta={monitor ? <MonitorMeta monitor={monitor} /> : <Skeleton width="calc(var(--space-16) * 6)" height="var(--text-secondary)" />}
        actions={
          monitor &&
          (confirmingDelete ? (
            <>
              <span className={styles.confirm}>Delete this monitor and stop its checks?</span>
              <Button size="sm" onClick={() => setConfirmingDelete(false)} disabled={pending === 'delete'}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" loading={pending === 'delete'} onClick={remove}>
                Delete monitor
              </Button>
            </>
          ) : (
            <>
              <ButtonLink size="sm" href={withRange(`/monitors/new?type=synthetic_check&target=${encodeURIComponent(id)}`, range)}>
                Create alert
              </ButtonLink>
              {runButton}
              <Button
                size="sm"
                loading={pending === 'toggle'}
                disabled={pending !== null}
                onClick={() => toggleEnabled(monitor)}
              >
                {monitor.enabled ? 'Pause' : 'Resume'}
              </Button>
              <Button size="sm" variant="danger" disabled={pending !== null} onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            </>
          ))
        }
      />

      {actionError && <Notice tone="error" title="Action failed.">{actionError}</Notice>}
      <StaleNotice error={monitorQuery.data ? monitorQuery.error : undefined} updatedAt={monitorQuery.updatedAt} onRetry={refreshAll} />
      <ResultsNotice error={monitorQuery.data?.resultsError} onRetry={refreshAll} />
      {monitor?.enabled && monitor.summary.lastStatus === 'down' && (
        <Notice tone="error" title="Latest check failed.">
          {monitor.summary.lastError}
          {monitor.summary.lastCheckedAt !== null && ` — ${formatRelative(monitor.summary.lastCheckedAt)}`}
        </Notice>
      )}

      {!monitor && monitorQuery.error ? (
        <ErrorState title="Unable to load monitor." description={monitorQuery.error.message} onRetry={refreshAll} />
      ) : (
        <>
          <SummaryMetrics monitor={monitor} resultsUnavailable={Boolean(monitorQuery.data?.resultsError)} />

          <Section title="Response time" actions={<LatencyLegend />}>
            {seriesQuery.data ? (
              <LatencyChart series={seriesQuery.data} subject={monitor?.name ?? 'monitor'} emptyAction={runButton} />
            ) : seriesQuery.error ? (
              <ErrorState fill="chart" title="Unable to query response time." description={seriesQuery.error.message} onRetry={seriesQuery.refetch} />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section title="Availability">
            {seriesQuery.data ? (
              <AvailabilityBar points={seriesQuery.data.points} />
            ) : seriesQuery.error ? (
              <p className={styles.reason}>Availability timeline unavailable.</p>
            ) : (
              <Skeleton height="var(--bar-height)" />
            )}
          </Section>

          <Section title="Recent checks" flush>
            {checksQuery.data ? (
              checksQuery.data.checks.length > 0 ? (
                <RecentChecksTable checks={checksQuery.data.checks} />
              ) : (
                <EmptyState
                  title="No checks yet"
                  description="The first check runs within a few seconds of creating or resuming a monitor."
                  action={runButton}
                />
              )
            ) : checksQuery.error ? (
              <ErrorState title="Unable to query recent checks." description={checksQuery.error.message} onRetry={checksQuery.refetch} />
            ) : (
              <RecentChecksSkeleton />
            )}
          </Section>
        </>
      )}
    </>
  );
}

function MonitorMeta({ monitor }: { monitor: MonitorWithSummary }) {
  const separator = (
    <span className={styles.metaSeparator} aria-hidden>
      ·
    </span>
  );
  return (
    <>
      <a href={monitor.url} target="_blank" rel="noreferrer" className={styles.metaUrl}>
        {monitor.url}
      </a>
      {separator}
      <span className={styles.mono}>{monitor.method}</span>
      {separator}
      <span>every {formatInterval(monitor.intervalSeconds)}</span>
      {separator}
      <span>
        expects <span className={styles.mono}>{monitor.expectedStatus}</span>
      </span>
      {separator}
      <span>timeout {formatLatency(monitor.timeoutMs)}</span>
    </>
  );
}

function SummaryMetrics({
  monitor,
  resultsUnavailable,
}: {
  monitor: MonitorWithSummary | undefined;
  /** Check results could not be queried; empty values are unknown, not "not yet". */
  resultsUnavailable: boolean;
}) {
  const loading = !monitor;
  const summary = monitor?.summary;
  const now = Date.now();
  const isHttps = monitor?.url.startsWith('https://') ?? false;
  const sslDays = summary?.sslExpiresAt != null ? daysUntil(summary.sslExpiresAt, now) : null;
  const unavailable = resultsUnavailable ? 'Results unavailable' : undefined;

  return (
    <MetricGrid label="Monitor summary">
      <Metric
        label="Uptime"
        loading={loading}
        value={formatPercent(summary?.availability)}
        tone={summary?.availability != null && summary.availability < 1 ? 'warning' : undefined}
        meta={unavailable ?? (summary && `${formatCount(summary.checks)} checks · ${formatCount(summary.failures)} failed`)}
      />
      <Metric
        label="P95 latency"
        loading={loading}
        value={formatLatency(summary?.p95LatencyMs)}
        meta={unavailable ?? (summary && `avg ${formatLatency(summary.avgLatencyMs)}`)}
      />
      <Metric
        label="Last response"
        loading={loading}
        value={formatLatency(summary?.lastLatencyMs)}
        tone={summary?.lastStatus === 'down' ? 'error' : undefined}
        meta={
          summary?.lastCheckedAt != null
            ? `${summary.lastStatusCode ? `HTTP ${summary.lastStatusCode}` : 'No response'} · ${formatRelative(summary.lastCheckedAt, now)}`
            : (unavailable ?? 'Waiting for first check')
        }
      />
      <Metric
        label="SSL expiry"
        loading={loading}
        value={formatDaysUntil(summary?.sslExpiresAt, now)}
        tone={sslDays !== null && sslDays <= SSL_WARNING_DAYS ? 'warning' : undefined}
        meta={
          !isHttps
            ? 'Not an HTTPS URL'
            : summary?.sslExpiresAt != null
              ? formatDate(summary.sslExpiresAt)
              : (unavailable ?? 'Not checked yet')
        }
      />
    </MetricGrid>
  );
}
