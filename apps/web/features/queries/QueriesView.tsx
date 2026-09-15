'use client';

import type { DbQueryListResponse, ServiceListResponse } from '@minidog/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { FilterBar, FilterChip, FilterSelect } from '@/components/layout/FilterBar';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { formatWindow, parseWindow, windowParams } from '@/components/observability/TimeSelection';
import { Button, ButtonLink } from '@/components/ui/Button';
import { tracesHref } from '@/lib/links';
import { toQuery, useQueryParams } from '@/lib/query-params';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { QueryTable, QueryTableSkeleton } from './QueryTable';
import styles from './Queries.module.scss';

const SORT_OPTIONS = [
  { value: '', label: 'Most time spent' },
  { value: 'p95', label: 'Slowest (P95)' },
  { value: 'calls', label: 'Most calls' },
];

const SORT_NOTES: Record<string, string> = {
  '': 'Most time spent first',
  p95: 'Slowest first (P95)',
  calls: 'Most calls first',
};

/** Database statements ranked by where the time goes. */
export function QueriesView() {
  const range = useTimeRange();
  const { get, set } = useQueryParams();
  const service = get('service');
  const sort = get('sort');
  const window = parseWindow(get('from'), get('to'));
  const hasFilters = Boolean(service) || window !== null;

  const services = useApi<ServiceListResponse>(`/services?range=${range}`, 60_000);
  const { data, error, isLoading, updatedAt, refetch } = useApi<DbQueryListResponse>(
    `/queries${toQuery({ range, service, sort, ...(window ? windowParams(window) : {}) })}`,
  );

  const serviceOptions = [
    { value: '', label: 'All services' },
    ...(services.data?.services.map((item) => ({ value: item.service, label: item.service })) ?? []),
    ...(service && !services.data?.services.some((item) => item.service === service) ? [{ value: service, label: service }] : []),
  ];
  const clear = () => set({ service: null, from: null, to: null });

  return (
    <>
      <PageHeader title="Database queries" />
      <FilterBar
        trailing={data && `${data.queries.length} statement${data.queries.length === 1 ? '' : 's'}${data.truncated ? ' (top 100)' : ''}`}
      >
        <FilterSelect label="Service" value={service} options={serviceOptions} onChange={(next) => set({ service: next })} />
        <FilterSelect label="Sort" value={sort} options={SORT_OPTIONS} onChange={(next) => set({ sort: next })} />
        {window && <FilterChip label="Window" value={formatWindow(window)} onClear={() => set({ from: null, to: null })} />}
      </FilterBar>
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      <Section
        title={
          <>
            Statements {data && <span className={styles.count}>{data.queries.length}</span>}
          </>
        }
        actions={<span className={styles.note}>{SORT_NOTES[sort] ?? SORT_NOTES['']} · literals shown as ? · opens the slowest call</span>}
        flush
      >
        {isLoading ? (
          <QueryTableSkeleton rows={5} />
        ) : !data ? (
          <ErrorState title="Unable to query database statements." description={error?.message} onRetry={refetch} />
        ) : data.queries.length > 0 ? (
          <QueryTable queries={data.queries} range={range} />
        ) : hasFilters ? (
          <EmptyState
            title="No database queries match these filters"
            description="Widen the time range or remove a filter."
            action={
              <Button size="sm" onClick={clear}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No database queries in this range"
            description="Queries come from database client spans that carry db.system.name and db.query.text, as OpenTelemetry database instrumentation records them."
            action={<ButtonLink href={tracesHref({}, range)}>View traces</ButtonLink>}
          />
        )}
      </Section>
    </>
  );
}
