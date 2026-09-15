'use client';

import type {
  AlertSummaryResponse,
  EndpointListResponse,
  EndpointSummary,
  HealthStatus,
  HostListResponse,
  OverviewResponse,
  ServiceListResponse,
  TimeRange,
} from '@minidog/types';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { Metric, MetricGrid } from '@/components/observability/Metric';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { StatusIndicator, type IndicatorStatus } from '@/components/observability/StatusIndicator';
import { drilldownLinks, SelectHint, SelectionBar, useChartSelection } from '@/components/observability/TimeSelection';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatChange, formatCount, formatLatency, formatPercent, formatRate, formatUtilization } from '@/lib/format';
import { serviceHref, tracesHref } from '@/lib/links';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { deploymentMarkers } from '../apm/deployments';
import { LatencyTrendChart, LatencyTrendLegend, RequestsChart, RequestsLegend } from '../apm/RequestCharts';
import { errorRateTone, latencyTone, ServiceTable, ServiceTableSkeleton } from '../apm/ServiceTable';
import { TelemetrySetup } from '../apm/TelemetrySetup';
import { HostTable } from '../infrastructure/HostTable';
import { hostHref } from '../infrastructure/host';
import { AlertStateIndicator, monitorHref } from '../monitors/alerting';
import { MonitorTable } from '../synthetics/MonitorTable';
import styles from './Overview.module.scss';

const SEVERITY: Partial<Record<HealthStatus, number>> = { critical: 0, degraded: 1 };

interface AttentionItem {
  key: string;
  severity: number;
  indicator: ReactNode;
  name: string;
  href: string;
  details: ReactNode;
  action: { label: string; href: string };
}

/**
 * Signal over data: first what needs a look and why, then the trends, then
 * every service, host and synthetic check.
 */
export function OverviewView() {
  const range = useTimeRange();
  const services = useApi<ServiceListResponse>(`/services?range=${range}&deployments=1`);
  const endpoints = useApi<EndpointListResponse>(`/endpoints?range=${range}`);
  const alerts = useApi<AlertSummaryResponse>('/alerting/summary');
  const hosts = useApi<HostListResponse>(`/hosts?range=${range}`);
  const synthetics = useApi<OverviewResponse>(`/overview?range=${range}`);
  const chart = useChartSelection<'latency' | 'requests'>();
  const markers = useMemo(() => deploymentMarkers(services.data?.deployments, true), [services.data]);

  const loading = !services.data;
  const serviceList = services.data?.services ?? [];
  const totals = services.data?.totals;
  const seconds = services.data ? services.data.series.points.length * services.data.series.stepSeconds : 1;
  const attentionServices = serviceList.filter((service) => SEVERITY[service.health] !== undefined).length;
  const active = alerts.data?.active ?? [];
  const criticalAlerts = active.filter((monitor) => monitor.state === 'critical').length;
  const nothingYet =
    services.data && serviceList.length === 0 && hosts.data?.hosts.length === 0 && synthetics.data?.counts.total === 0;

  const attention = buildAttention({
    range,
    services: services.data,
    endpoints: endpoints.data?.endpoints ?? [],
    alerts: alerts.data,
    hosts: hosts.data,
    synthetics: synthetics.data,
  });

  return (
    <>
      <PageHeader title="Overview" />
      <StaleNotice
        error={services.data ? services.error : undefined}
        updatedAt={services.updatedAt}
        onRetry={services.refetch}
      />

      {!services.data && !services.isLoading ? (
        <ErrorState title="Unable to load overview." description={services.error?.message} onRetry={services.refetch} />
      ) : nothingYet ? (
        <EmptyState
          title="Nothing is reporting yet"
          description="Send traces, logs and metrics with an OpenTelemetry SDK, or add a URL monitor to start with synthetic checks."
          action={
            <div className={styles.onboarding}>
              <TelemetrySetup />
              <ButtonLink href={withRange('/synthetics/new', range)}>Add a URL monitor</ButtonLink>
            </div>
          }
        />
      ) : (
        <>
          <MetricGrid label="Summary">
            <Metric
              label="Services"
              loading={loading}
              value={serviceList.length}
              tone={attentionServices > 0 ? 'warning' : undefined}
              meta={attentionServices > 0 ? `${attentionServices} need attention` : 'all healthy'}
            />
            <Metric
              label="Requests"
              loading={loading}
              value={formatCount(totals?.requests)}
              meta={totals && formatRate(totals.requests / seconds)}
            />
            <Metric
              label="Error rate"
              loading={loading}
              value={formatPercent(totals?.errorRate)}
              tone={errorRateTone(totals?.errorRate)}
              meta={totals && `${formatCount(totals.errors)} errors`}
            />
            <Metric
              label="P95 latency"
              loading={loading}
              value={formatLatency(totals?.p95Ms)}
              tone={latencyTone(totals?.p95Ms)}
              meta={totals && `P99 ${formatLatency(totals.p99Ms)}`}
            />
            <Metric
              label="Active alerts"
              loading={!alerts.data && !alerts.error}
              value={alerts.data ? active.length : '—'}
              tone={criticalAlerts > 0 ? 'error' : active.length > 0 ? 'warning' : undefined}
              meta={
                alerts.data ? (active.length > 0 ? `${criticalAlerts} critical` : 'no monitor alerting') : 'unavailable'
              }
            />
          </MetricGrid>

          {attention.length > 0 && (
            <Section
              title={
                <>
                  <span className={styles.attentionShape} aria-hidden />
                  {attention.length} {attention.length === 1 ? 'thing needs' : 'things need'} attention
                </>
              }
            >
              <ul className={styles.attention}>
                {attention.map((item) => (
                  <li key={item.key} className={styles.attentionItem}>
                    <div className={styles.attentionHead}>
                      {item.indicator}
                      <Link href={item.href} className={styles.attentionName}>
                        {item.name}
                      </Link>
                    </div>
                    <div className={styles.attentionDetails}>{item.details}</div>
                    <Link href={item.action.href} className={styles.attentionLink}>
                      {item.action.label}
                      <Icon name="arrow-right" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title="Request throughput"
            actions={
              <>
                <SelectHint />
                <RequestsLegend />
              </>
            }
          >
            {chart.selectionFor('requests') && (
              <SelectionBar
                selection={chart.selectionFor('requests')!}
                links={drilldownLinks(chart.selectionFor('requests')!, range)}
                onClear={chart.clear}
              />
            )}
            {services.data ? (
              <RequestsChart
                series={services.data.series}
                onSelectRange={chart.select('requests')}
                markers={markers}
                subject="all services"
                emptyAction={<ButtonLink href={withRange('/services', range)}>View services</ButtonLink>}
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
            {chart.selectionFor('latency') && (
              <SelectionBar
                selection={chart.selectionFor('latency')!}
                links={drilldownLinks(chart.selectionFor('latency')!, range)}
                onClear={chart.clear}
              />
            )}
            {services.data ? (
              <LatencyTrendChart
                series={services.data.series}
                onSelectRange={chart.select('latency')}
                markers={markers}
                subject="all services"
                emptyAction={<ButtonLink href={withRange('/services', range)}>View services</ButtonLink>}
              />
            ) : (
              <Skeleton height="var(--chart-height)" />
            )}
          </Section>

          <Section
            title="Services"
            flush
            actions={
              <ButtonLink href={withRange('/services', range)} variant="ghost" size="sm">
                View all
              </ButtonLink>
            }
          >
            {!services.data ? (
              <ServiceTableSkeleton />
            ) : serviceList.length > 0 ? (
              <ServiceTable services={serviceList} range={range} />
            ) : (
              <EmptyState
                title="No services yet"
                description="Services appear when an OpenTelemetry SDK sends traces."
                action={<TelemetrySetup />}
              />
            )}
          </Section>

          {hosts.data && hosts.data.hosts.length > 0 && (
            <Section
              title="Hosts"
              flush
              actions={
                <ButtonLink href={withRange('/infrastructure', range)} variant="ghost" size="sm">
                  View all
                </ButtonLink>
              }
            >
              <HostTable hosts={hosts.data.hosts} range={range} />
            </Section>
          )}

          {synthetics.data && synthetics.data.counts.total > 0 && (
            <Section
              title="Synthetics"
              flush
              actions={
                <ButtonLink href={withRange('/synthetics', range)} variant="ghost" size="sm">
                  View all
                </ButtonLink>
              }
            >
              <MonitorTable monitors={synthetics.data.monitors} range={range} />
            </Section>
          )}
        </>
      )}
    </>
  );
}

const HEALTH_SEVERITY: Record<string, number> = { critical: 0, degraded: 1, warning: 1 };

/** The endpoint most likely behind a service's problem: most errors, then slowest. */
function likelyEndpoint(endpoints: readonly EndpointSummary[], service: string): EndpointSummary | undefined {
  return endpoints
    .filter((endpoint) => endpoint.service === service)
    .sort((a, b) => b.errors - a.errors || (b.p95Ms ?? 0) - (a.p95Ms ?? 0))[0];
}

function buildAttention({
  range,
  services,
  endpoints,
  alerts,
  hosts,
  synthetics,
}: {
  range: TimeRange;
  services: ServiceListResponse | undefined;
  endpoints: readonly EndpointSummary[];
  alerts: AlertSummaryResponse | undefined;
  hosts: HostListResponse | undefined;
  synthetics: OverviewResponse | undefined;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const service of services?.services ?? []) {
    const severity = HEALTH_SEVERITY[service.health];
    if (severity === undefined) continue;
    const endpoint = likelyEndpoint(endpoints, service.service);
    items.push({
      key: `service:${service.service}`,
      severity,
      indicator: <StatusIndicator status={service.health} />,
      name: service.service,
      href: serviceHref(service.service, range),
      details: (
        <>
          <Detail label="P95 latency">
            {formatLatency(service.p95Ms)}
            {service.p95Change !== null && Math.abs(service.p95Change) >= 0.1 && (
              <span className={service.p95Change > 0 ? styles.worse : styles.better}>
                {' '}
                {formatChange(service.p95Change)}
              </span>
            )}
          </Detail>
          <Detail label="Error rate">{formatPercent(service.errorRate)}</Detail>
          {endpoint && <Detail label="Likely affected endpoint">{endpoint.endpoint}</Detail>}
          {service.healthReason && <span className={styles.attentionReason}>{service.healthReason}</span>}
        </>
      ),
      action: {
        label: 'View traces',
        href: tracesHref(
          { service: service.service, endpoint: endpoint?.endpoint, status: service.errors > 0 ? 'error' : undefined },
          range,
        ),
      },
    });
  }

  for (const monitor of alerts?.active ?? []) {
    items.push({
      key: `monitor:${monitor.id}`,
      severity: HEALTH_SEVERITY[monitor.state] ?? 2,
      indicator: <AlertStateIndicator state={monitor.state} />,
      name: monitor.name,
      href: monitorHref(monitor.id, range),
      details: <span className={styles.attentionReason}>{monitor.stateMessage}</span>,
      action: { label: 'View monitor', href: monitorHref(monitor.id, range) },
    });
  }

  for (const host of hosts?.hosts ?? []) {
    const severity = HEALTH_SEVERITY[host.health];
    if (severity === undefined) continue;
    items.push({
      key: `host:${host.host}`,
      severity,
      indicator: <StatusIndicator status={host.health} />,
      name: host.host,
      href: hostHref(host.host, range),
      details: (
        <>
          <Detail label="CPU">{formatUtilization(host.cpu)}</Detail>
          <Detail label="Memory">{formatUtilization(host.memory)}</Detail>
          <Detail label="Disk">{formatUtilization(host.disk)}</Detail>
        </>
      ),
      action: { label: 'View host', href: hostHref(host.host, range) },
    });
  }

  for (const monitor of synthetics?.monitors ?? []) {
    const severity = monitor.enabled ? HEALTH_SEVERITY[monitor.summary.health] : undefined;
    if (severity === undefined) continue;
    const href = withRange(`/synthetics/${monitor.id}`, range);
    items.push({
      key: `synthetic:${monitor.id}`,
      severity,
      indicator: <StatusIndicator status={monitor.summary.health as IndicatorStatus} />,
      name: monitor.name,
      href,
      details: (
        <>
          <span className={styles.attentionReason}>{monitor.summary.healthReason}</span>
          {monitor.summary.lastStatus === 'down' && monitor.summary.lastError && (
            <span className={styles.attentionError}>{monitor.summary.lastError}</span>
          )}
        </>
      ),
      action: { label: 'View check', href },
    });
  }

  return items.sort((a, b) => a.severity - b.severity);
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={styles.detail}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{children}</span>
    </span>
  );
}
