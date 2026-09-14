'use client';

import { HOST_CURRENT_WINDOW_SECONDS, type HostListResponse } from '@minidog/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { HostTable, HostTableSkeleton } from './HostTable';
import styles from './Infrastructure.module.scss';

const COLLECTOR_SNIPPET = `exporters:
  otlp_http/minidog:
    endpoint: http://<minidog-api>:4000
    encoding: json`;

export function InfrastructureView() {
  const range = useTimeRange();
  const { data, error, isLoading, updatedAt, refetch } = useApi<HostListResponse>(`/hosts?range=${range}`);

  return (
    <>
      <PageHeader title="Infrastructure" />
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      {isLoading ? (
        <Section title="Hosts" flush>
          <HostTableSkeleton />
        </Section>
      ) : !data ? (
        <ErrorState title="Unable to load hosts." description={error?.message} onRetry={refetch} />
      ) : data.hosts.length === 0 ? (
        <EmptyState
          title="No hosts reporting"
          description="Host metrics come from the OpenTelemetry Collector hostmetrics receiver. The bundled collector (pnpm infra:up) sends them to the API; any other collector can export OTLP/HTTP JSON to /v1/metrics."
          action={
            <pre className={styles.snippet}>
              <code>{COLLECTOR_SNIPPET}</code>
            </pre>
          }
        />
      ) : (
        <Section
          title={
            <>
              Hosts <span className={styles.count}>{data.hosts.length}</span>
            </>
          }
          actions={<span className={styles.note}>Current values: last {HOST_CURRENT_WINDOW_SECONDS / 60} min</span>}
          flush
        >
          <HostTable hosts={data.hosts} range={range} />
        </Section>
      )}
    </>
  );
}
