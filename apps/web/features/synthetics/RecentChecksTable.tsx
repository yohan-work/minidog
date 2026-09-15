import type { CheckResult } from '@minidog/types';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { Table, TableHead, TableSkeleton, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { EMPTY, formatDateTime, formatLatency } from '@/lib/format';
import styles from './Synthetics.module.scss';

const COLUMNS = [
  { label: 'Time' },
  { label: 'Result' },
  { label: 'Code', align: 'end' },
  { label: 'Latency', align: 'end' },
  { label: 'DNS', align: 'end', hideBelow: 'desktop' },
  { label: 'Connect', align: 'end', hideBelow: 'desktop' },
  { label: 'TLS', align: 'end', hideBelow: 'desktop' },
  { label: 'TTFB', align: 'end', hideBelow: 'tablet' },
  { label: 'Error' },
] as const satisfies readonly ColumnSpec[];

export function RecentChecksTable({ checks }: { checks: readonly CheckResult[] }) {
  return (
    <Table aria-label="Recent checks">
      <TableHead columns={COLUMNS} />
      <tbody>
        {checks.map((check, index) => (
          <Tr key={`${check.timestamp}-${index}`}>
            <Td mono muted>
              {formatDateTime(check.timestamp)}
            </Td>
            <Td>
              <span className={styles.result}>
                <StatusIndicator status={check.status} />
                {check.redirects > 0 && (
                  <span className={styles.redirects} title={`Followed ${check.redirects} redirect${check.redirects === 1 ? '' : 's'} to ${check.finalUrl}`}>
                    ↪ {check.redirects}
                  </span>
                )}
              </span>
            </Td>
            <Td align="end" mono>
              {check.statusCode || EMPTY}
            </Td>
            <Td align="end" mono>
              {formatLatency(check.latencyMs)}
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatLatency(check.dnsMs)}
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatLatency(check.connectMs)}
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatLatency(check.tlsMs)}
            </Td>
            <Td align="end" mono muted hideBelow="tablet">
              {formatLatency(check.ttfbMs)}
            </Td>
            <Td mono>
              <span className={styles.errorText} title={check.error || undefined}>
                {check.error || EMPTY}
              </span>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export function RecentChecksSkeleton() {
  return <TableSkeleton columns={COLUMNS} rows={5} label="Loading recent checks" />;
}
