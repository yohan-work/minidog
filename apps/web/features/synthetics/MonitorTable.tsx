import type { MonitorSummary, MonitorWithSummary, TimeRange } from '@minidog/types';
import { monitorStatus, StatusIndicator } from '@/components/observability/StatusIndicator';
import { RowLink, Table, TableHead, TableSkeleton, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { daysUntil, EMPTY, formatDaysUntil, formatLatency, formatPercent, formatRelative } from '@/lib/format';
import { withRange } from '@/lib/time-range';
import styles from './MonitorTable.module.scss';

export const SSL_WARNING_DAYS = 14;

const COLUMNS = [
  { label: 'Status' },
  { label: 'Monitor' },
  { label: 'Availability', align: 'end' },
  { label: 'P95', align: 'end' },
  { label: 'Last response', align: 'end', hideBelow: 'tablet' },
  { label: 'SSL expiry', align: 'end', hideBelow: 'desktop' },
  { label: 'Last check', align: 'end', hideBelow: 'desktop' },
] as const satisfies readonly ColumnSpec[];

export function MonitorTable({ monitors, range }: { monitors: readonly MonitorWithSummary[]; range: TimeRange }) {
  const now = Date.now();
  return (
    <Table aria-label="Synthetic monitors">
      <TableHead columns={COLUMNS} />
      <tbody>
        {monitors.map((monitor) => {
          const { summary } = monitor;
          const sslSoon = summary.sslExpiresAt !== null && daysUntil(summary.sslExpiresAt, now) <= SSL_WARNING_DAYS;
          return (
            <Tr key={monitor.id} interactive>
              <Td>
                <StatusIndicator status={monitorStatus(monitor)} />
              </Td>
              <Td>
                <span className={styles.monitor}>
                  <RowLink href={withRange(`/synthetics/${monitor.id}`, range)} className={styles.name}>
                    {monitor.name}
                  </RowLink>
                  <span className={styles.url}>{monitor.url}</span>
                </span>
              </Td>
              <Td align="end" mono>
                {formatPercent(summary.availability)}
              </Td>
              <Td align="end" mono>
                {formatLatency(summary.p95LatencyMs)}
              </Td>
              <Td align="end" mono hideBelow="tablet">
                <LastResponse summary={summary} />
              </Td>
              <Td align="end" mono hideBelow="desktop" className={sslSoon ? styles.warning : undefined}>
                {formatDaysUntil(summary.sslExpiresAt, now)}
              </Td>
              <Td align="end" mono muted hideBelow="desktop">
                {formatRelative(summary.lastCheckedAt, now)}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function LastResponse({ summary }: { summary: MonitorSummary }) {
  if (summary.lastStatus === null) return <>{EMPTY}</>;
  const code = summary.lastStatusCode ? String(summary.lastStatusCode) : 'ERR';
  return (
    <span className={summary.lastStatus === 'down' ? styles.error : undefined}>
      {code} · {formatLatency(summary.lastLatencyMs)}
    </span>
  );
}

export function MonitorTableSkeleton({ rows }: { rows?: number }) {
  return <TableSkeleton columns={COLUMNS} rows={rows} label="Loading monitors" />;
}
