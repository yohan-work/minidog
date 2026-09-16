'use client';

import { HOST_CURRENT_WINDOW_SECONDS, type ContextResponse, type HostListResponse } from '@minidog/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { CodeSnippet } from '@/components/ui/CodeSnippet';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { HostTable, HostTableSkeleton } from './HostTable';
import styles from './Infrastructure.module.scss';

/** Until /context loads; the same default the API reports for a local install. */
const FALLBACK_API_URL = 'http://localhost:4000';

export function InfrastructureView() {
  const range = useTimeRange();
  const { data, error, isLoading, updatedAt, refetch } = useApi<HostListResponse>(`/hosts?range=${range}`);
  const context = useApi<ContextResponse>('/context', 60_000);
  const apiUrl = context.data?.ingest.apiUrl ?? FALLBACK_API_URL;

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
          description="Host metrics come from the OpenTelemetry Collector hostmetrics receiver. The collector that ships with minidog sends them on its own; any other collector can export OTLP/HTTP JSON to /v1/metrics, at an address it can reach."
          action={
            <CodeSnippet
              title="Your own collector"
              code={`exporters:\n  otlp_http/minidog:\n    endpoint: ${apiUrl}\n    encoding: json`}
            />
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
