'use client';

import type { AlertMonitorListResponse, AlertSummaryResponse } from '@minidog/types';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { RowLink, Table, TableHead, TableSkeleton, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { apiFetch } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { AlertEventTable } from './AlertEventTable';
import { AlertStateIndicator, conditionText, formatAlertValue, isMutedNow, monitorHref, TYPE_LABELS } from './alerting';
import styles from './Monitors.module.scss';

const COLUMNS = [
  { label: 'State' },
  { label: 'Monitor' },
  { label: 'Value', align: 'end' },
  { label: 'Condition', hideBelow: 'tablet' },
  { label: 'Changed', align: 'end', hideBelow: 'desktop' },
] as const satisfies readonly ColumnSpec[];

export function MonitorsView() {
  const range = useTimeRange();
  const { data, error, isLoading, updatedAt, refetch } = useApi<AlertMonitorListResponse>('/alerting/monitors');
  const summary = useApi<AlertSummaryResponse>('/alerting/summary');
  const [acknowledging, setAcknowledging] = useState(false);
  const newHref = withRange('/monitors/new', range);
  const types = new Map(data?.monitors.map((monitor) => [monitor.id, monitor]) ?? []);

  const acknowledge = async () => {
    setAcknowledging(true);
    try {
      await apiFetch('/alerting/events/acknowledge', { method: 'POST' });
      summary.refetch();
    } finally {
      setAcknowledging(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Monitors"
        actions={
          <ButtonLink href={newHref} variant="primary">
            <Icon name="plus" size={14} />
            New monitor
          </ButtonLink>
        }
      />
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      {isLoading ? (
        <Section title="Monitors" flush>
          <TableSkeleton columns={COLUMNS} label="Loading monitors" />
        </Section>
      ) : !data ? (
        <ErrorState title="Unable to load monitors." description={error?.message} onRetry={refetch} />
      ) : data.monitors.length === 0 ? (
        <EmptyState
          title="No monitors yet"
          description="Monitors watch service availability, error rate, latency, host CPU or memory and synthetic URL checks, and notify on every state change."
          action={<ButtonLink href={newHref}>New monitor</ButtonLink>}
        />
      ) : (
        <>
          <Section
            title={
              <>
                Monitors <span className={styles.count}>{data.monitors.length}</span>
              </>
            }
            flush
          >
            <Table aria-label="Monitors">
              <TableHead columns={COLUMNS} />
              <tbody>
                {data.monitors.map((monitor) => (
                  <Tr key={monitor.id} interactive>
                    <Td>
                      <span className={styles.transition}>
                        <AlertStateIndicator state={monitor.state} enabled={monitor.enabled} />
                        {monitor.enabled && isMutedNow(monitor) && <span className={styles.note}>muted</span>}
                      </span>
                    </Td>
                    <Td>
                      <span className={styles.monitor}>
                        <RowLink href={monitorHref(monitor.id, range)} className={styles.name}>
                          {monitor.name}
                        </RowLink>
                        <span className={styles.target}>
                          {TYPE_LABELS[monitor.type]}
                          {monitor.type !== 'heartbeat' && ` · ${monitor.targetLabel}`}
                        </span>
                      </span>
                    </Td>
                    <Td
                      align="end"
                      mono
                      className={
                        monitor.state === 'critical'
                          ? styles.error
                          : monitor.state === 'warning'
                            ? styles.warning
                            : undefined
                      }
                    >
                      {formatAlertValue(monitor, monitor.stateValue)}
                    </Td>
                    <Td mono muted hideBelow="tablet">
                      {conditionText(monitor)}
                    </Td>
                    <Td align="end" mono muted hideBelow="desktop">
                      {monitor.stateChangedAt ? formatRelative(Date.parse(monitor.stateChangedAt)) : '—'}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>

          <Section
            title={
              <>
                Alert history{' '}
                {summary.data && summary.data.unread > 0 && (
                  <span className={styles.unread}>{summary.data.unread} new</span>
                )}
              </>
            }
            actions={
              summary.data && summary.data.unread > 0 ? (
                <Button size="sm" variant="ghost" loading={acknowledging} onClick={acknowledge}>
                  Mark all read
                </Button>
              ) : undefined
            }
            flush
          >
            {summary.data ? (
              summary.data.recent.length > 0 ? (
                <AlertEventTable events={summary.data.recent} range={range} types={types} />
              ) : (
                <EmptyState
                  title="No state changes yet"
                  description="Each change between Healthy, Warning and Critical is recorded here and sent to the monitor's webhook."
                  action={
                    <Button size="sm" onClick={summary.refetch}>
                      Refresh
                    </Button>
                  }
                />
              )
            ) : summary.error ? (
              <ErrorState
                title="Unable to load alert history."
                description={summary.error.message}
                onRetry={summary.refetch}
              />
            ) : (
              <TableSkeleton columns={COLUMNS} rows={2} label="Loading alert history" />
            )}
          </Section>
        </>
      )}
    </>
  );
}
