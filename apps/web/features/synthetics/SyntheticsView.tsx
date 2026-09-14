'use client';

import type { MonitorListResponse } from '@minidog/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { withRange, useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { MonitorTable, MonitorTableSkeleton } from './MonitorTable';
import { ResultsNotice } from './ResultsNotice';
import styles from './Synthetics.module.scss';

export function SyntheticsView() {
  const range = useTimeRange();
  const { data, error, isLoading, updatedAt, refetch } = useApi<MonitorListResponse>(`/monitors?range=${range}`);
  const newHref = withRange('/synthetics/new', range);

  return (
    <>
      <PageHeader
        title="Synthetics"
        actions={
          <ButtonLink href={newHref} variant="primary">
            <Icon name="plus" size={14} />
            New monitor
          </ButtonLink>
        }
      />
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />
      <ResultsNotice error={data?.resultsError} onRetry={refetch} />

      {isLoading ? (
        <Section title="Monitors" flush>
          <MonitorTableSkeleton />
        </Section>
      ) : !data ? (
        <ErrorState title="Unable to load monitors." description={error?.message} onRetry={refetch} />
      ) : data.monitors.length === 0 ? (
        <EmptyState
          title="No monitors yet"
          description="Add a URL to check its status code, response time and SSL certificate on a schedule."
          action={<ButtonLink href={newHref}>New monitor</ButtonLink>}
        />
      ) : (
        <Section
          title={
            <>
              Monitors <span className={styles.count}>{data.monitors.length}</span>
            </>
          }
          flush
        >
          <MonitorTable monitors={data.monitors} range={range} />
        </Section>
      )}
    </>
  );
}
