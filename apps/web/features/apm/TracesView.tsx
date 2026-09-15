'use client';

import type { ServiceListResponse, TraceListResponse } from '@minidog/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { FilterBar, FilterChip, FilterSelect, SearchField } from '@/components/layout/FilterBar';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { formatWindow, parseWindow, windowParams } from '@/components/observability/TimeSelection';
import { Button } from '@/components/ui/Button';
import { toQuery, useQueryParams } from '@/lib/query-params';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { TelemetrySetup } from './TelemetrySetup';
import { TraceTable, TraceTableSkeleton } from './TraceTable';
import styles from './Apm.module.scss';

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'error', label: 'Errors' },
  { value: 'ok', label: 'No errors' },
];

const DURATION_OPTIONS = [
  { value: '', label: 'Any duration' },
  { value: '100', label: '≥ 100 ms' },
  { value: '500', label: '≥ 500 ms' },
  { value: '1000', label: '≥ 1 s' },
  { value: '3000', label: '≥ 3 s' },
];

const SORT_OPTIONS = [
  { value: '', label: 'Newest first' },
  { value: 'slowest', label: 'Slowest first' },
];

const LIMIT = 100;

export function TracesView() {
  const range = useTimeRange();
  const { get, set } = useQueryParams();
  const window = parseWindow(get('from'), get('to'));
  const filters = {
    service: get('service'),
    endpoint: get('endpoint'),
    status: get('status'),
    minDurationMs: get('minDurationMs'),
    q: get('q'),
  };
  const sort = get('sort');
  const hasFilters = Object.values(filters).some(Boolean) || window !== null;

  const services = useApi<ServiceListResponse>(`/services?range=${range}`, 60_000);
  const { data, error, isLoading, updatedAt, refetch } = useApi<TraceListResponse>(
    `/traces${toQuery({ range, limit: LIMIT, sort, ...filters, ...(window ? windowParams(window) : {}) })}`,
  );

  const serviceOptions = [
    { value: '', label: 'All services' },
    ...(services.data?.services.map((service) => ({ value: service.service, label: service.service })) ?? []),
    ...(filters.service && !services.data?.services.some((service) => service.service === filters.service)
      ? [{ value: filters.service, label: filters.service }]
      : []),
  ];

  const clear = () =>
    set({ service: null, endpoint: null, status: null, minDurationMs: null, q: null, from: null, to: null });
  const count =
    data &&
    (data.truncated
      ? `${sort === 'slowest' ? 'Slowest' : 'Latest'} ${LIMIT}`
      : `${data.traces.length} trace${data.traces.length === 1 ? '' : 's'}`);

  return (
    <>
      <PageHeader title="Traces" />
      <FilterBar trailing={count}>
        <FilterSelect
          label="Service"
          value={filters.service}
          options={serviceOptions}
          onChange={(service) => set({ service, endpoint: null })}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={STATUS_OPTIONS}
          onChange={(status) => set({ status })}
        />
        <FilterSelect
          label="Duration"
          value={filters.minDurationMs}
          options={DURATION_OPTIONS}
          onChange={(minDurationMs) => set({ minDurationMs })}
        />
        <FilterSelect label="Sort" value={sort} options={SORT_OPTIONS} onChange={(next) => set({ sort: next })} />
        {window && (
          <FilterChip label="Window" value={formatWindow(window)} onClear={() => set({ from: null, to: null })} />
        )}
        {filters.endpoint && (
          <FilterChip label="Endpoint" value={filters.endpoint} onClear={() => set({ endpoint: null })} />
        )}
        <SearchField
          label="Search traces"
          value={filters.q}
          placeholder="Trace id or name…"
          onChange={(q) => set({ q })}
        />
      </FilterBar>
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      <Section
        title={
          <>
            {filters.service ? 'Requests' : 'Root spans'}
            {data && <span className={styles.count}>{data.traces.length}</span>}
          </>
        }
        actions={
          <span className={styles.note}>
            {filters.service ? `Server spans of ${filters.service}` : 'One row per trace'}
          </span>
        }
        flush
      >
        {isLoading ? (
          <TraceTableSkeleton rows={8} />
        ) : !data ? (
          <ErrorState title="Unable to query traces." description={error?.message} onRetry={refetch} />
        ) : data.traces.length > 0 ? (
          <TraceTable traces={data.traces} range={range} label="Traces" />
        ) : hasFilters ? (
          <EmptyState
            title="No traces match these filters"
            description={
              window
                ? 'Nothing matched in the selected window. Widen it or remove a filter.'
                : 'Widen the time range or remove a filter.'
            }
            action={
              <Button size="sm" onClick={clear}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No traces yet"
            description="Send your first trace using OpenTelemetry."
            action={<TelemetrySetup />}
          />
        )}
      </Section>
    </>
  );
}
