import type { HostSummary, TimeRange } from '@minidog/types';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { RowLink, Table, TableHead, TableSkeleton, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { formatBytesRate, formatRelative, formatUtilization } from '@/lib/format';
import { hostHref, utilizationTone } from './host';
import styles from './Infrastructure.module.scss';

const COLUMNS = [
  { label: 'Status' },
  { label: 'Host' },
  { label: 'CPU', align: 'end' },
  { label: 'Memory', align: 'end' },
  { label: 'Disk', align: 'end', hideBelow: 'tablet' },
  { label: 'Network in', align: 'end', hideBelow: 'desktop' },
  { label: 'Network out', align: 'end', hideBelow: 'desktop' },
  { label: 'Last seen', align: 'end', hideBelow: 'desktop' },
] as const satisfies readonly ColumnSpec[];

export function HostTable({ hosts, range }: { hosts: readonly HostSummary[]; range: TimeRange }) {
  const now = Date.now();
  return (
    <Table aria-label="Hosts">
      <TableHead columns={COLUMNS} />
      <tbody>
        {hosts.map((host) => (
          <Tr key={host.host} interactive>
            <Td>
              <StatusIndicator status={host.health} />
            </Td>
            <Td>
              <span className={styles.host}>
                <RowLink href={hostHref(host.host, range)} className={styles.hostName}>
                  {host.host}
                </RowLink>
                {host.os && <span className={styles.os}>{host.os}</span>}
              </span>
            </Td>
            <UtilizationCell value={host.cpu} />
            <UtilizationCell value={host.memory} />
            <UtilizationCell value={host.disk} hideBelow="tablet" />
            <Td align="end" mono hideBelow="desktop">
              {formatBytesRate(host.networkRxBps)}
            </Td>
            <Td align="end" mono hideBelow="desktop">
              {formatBytesRate(host.networkTxBps)}
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatRelative(host.lastSeenAt, now)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function UtilizationCell({ value, hideBelow }: { value: number | null; hideBelow?: 'tablet' }) {
  const tone = utilizationTone(value);
  return (
    <Td align="end" mono hideBelow={hideBelow} className={tone ? styles[tone] : undefined}>
      {formatUtilization(value)}
    </Td>
  );
}

export function HostTableSkeleton() {
  return <TableSkeleton columns={COLUMNS} label="Loading hosts" />;
}
