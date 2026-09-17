'use client';

import type { ErrorGroup, ErrorListResponse, ServiceListResponse, TimeRange } from '@minidog/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { FilterBar, FilterChip, FilterSelect } from '@/components/layout/FilterBar';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { formatWindow, parseWindow, windowParams } from '@/components/observability/TimeSelection';
import { Button, ButtonLink } from '@/components/ui/Button';
import { RowLink, Table, TableHead, TableSkeleton, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { formatCount, formatRelative } from '@/lib/format';
import { traceHref, tracesHref } from '@/lib/links';
import { withRange } from '@/lib/range-href';
import { toQuery, useQueryParams } from '@/lib/query-params';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import styles from './Errors.module.scss';

const COLUMNS = [
  { label: 'Exception' },
  { label: 'Traces', align: 'end' },
  { label: 'Recorded', align: 'end', hideBelow: 'tablet' },
  { label: 'Endpoints', hideBelow: 'desktop' },
  { label: 'First seen', align: 'end', hideBelow: 'desktop' },
  { label: 'Last seen', align: 'end' },
] as const satisfies readonly ColumnSpec[];

const MAX_ENDPOINTS = 3;

/** Exceptions recorded on spans, grouped by type and message, most affected traces first. */
export function ErrorsView() {
  const range = useTimeRange();
  const { get, set } = useQueryParams();
  const service = get('service');
  const window = parseWindow(get('from'), get('to'));
  const hasFilters = Boolean(service) || window !== null;

  const services = useApi<ServiceListResponse>(`/services?range=${range}`, 60_000);
  const { data, error, isLoading, updatedAt, refetch } = useApi<ErrorListResponse>(
    `/errors${toQuery({ range, service, ...(window ? windowParams(window) : {}) })}`,
  );

  const serviceOptions = [
    { value: '', label: 'All services' },
    ...(services.data?.services.map((item) => ({ value: item.service, label: item.service })) ?? []),
    ...(service && !services.data?.services.some((item) => item.service === service)
      ? [{ value: service, label: service }]
      : []),
  ];
  const clear = () => set({ service: null, from: null, to: null });

  return (
    <>
      <PageHeader
        title="Errors"
        actions={
          <ButtonLink
            href={withRange(
              `/traces${toQuery({ status: 'error', service, ...(window ? windowParams(window) : {}) })}`,
              range,
            )}
            size="sm"
          >
            Error traces
          </ButtonLink>
        }
      />
      <FilterBar
        trailing={
          data &&
          `${data.groups.length} group${data.groups.length === 1 ? '' : 's'}${data.truncated ? ' (top 100)' : ''}`
        }
      >
        <FilterSelect
          label="Service"
          value={service}
          options={serviceOptions}
          onChange={(next) => set({ service: next })}
        />
        {window && (
          <FilterChip label="Window" value={formatWindow(window)} onClear={() => set({ from: null, to: null })} />
        )}
      </FilterBar>
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      <Section
        title={<>Exceptions {data && <span className={styles.count}>{data.groups.length}</span>}</>}
        actions={
          <span className={styles.note}>
            Grouped by type and message · most affected traces first · opens the latest trace
          </span>
        }
        flush
      >
        {isLoading ? (
          <TableSkeleton columns={COLUMNS} rows={5} label="Loading exceptions" />
        ) : !data ? (
          <ErrorState title="Unable to query exceptions." description={error?.message} onRetry={refetch} />
        ) : data.groups.length > 0 ? (
          <ErrorTable groups={data.groups} range={range} />
        ) : hasFilters ? (
          <EmptyState
            title="No exceptions match these filters"
            description="Widen the time range or remove a filter."
            action={
              <Button size="sm" onClick={clear}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No exceptions in this range"
            description="Exceptions appear when a span records one, e.g. span.recordException(error) in the OpenTelemetry SDK."
            action={<ButtonLink href={tracesHref({ status: 'error' }, range)}>View error traces</ButtonLink>}
          />
        )}
      </Section>
    </>
  );
}

function ErrorTable({ groups, range }: { groups: readonly ErrorGroup[]; range: TimeRange }) {
  const now = Date.now();
  return (
    <Table aria-label="Exceptions">
      <TableHead columns={COLUMNS} />
      <tbody>
        {groups.map((group) => (
          <Tr key={`${group.type}\n${group.message}`} interactive>
            <Td>
              <span className={styles.exception}>
                <RowLink
                  href={traceHref(group.latestTraceId, range, undefined, group.lastSeenAt)}
                  className={styles.type}
                >
                  {group.type || 'Exception'}
                </RowLink>
                <span className={styles.message} title={group.message || undefined}>
                  {group.message || 'No message'}
                </span>
                <span className={styles.services}>{group.services.join(', ')}</span>
              </span>
            </Td>
            <Td align="end" mono>
              {formatCount(group.traces)}
            </Td>
            <Td align="end" mono muted hideBelow="tablet">
              {formatCount(group.count)}
            </Td>
            <Td mono muted hideBelow="desktop">
              <span className={styles.endpoints} title={group.endpoints.join('\n') || undefined}>
                {group.endpoints.length === 0
                  ? '—'
                  : group.endpoints.slice(0, MAX_ENDPOINTS).join(', ') +
                    (group.endpoints.length > MAX_ENDPOINTS ? ` +${group.endpoints.length - MAX_ENDPOINTS}` : '')}
              </span>
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatRelative(group.firstSeenAt, now)}
            </Td>
            <Td align="end" mono>
              {formatRelative(group.lastSeenAt, now)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
