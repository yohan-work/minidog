import type { VersionSummary } from '@minidog/types';
import { Table, TableHead, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { formatCount, formatDateTime, formatLatency, formatPercent, formatRelative } from '@/lib/format';
import styles from './Apm.module.scss';

const COLUMNS = [
  { label: 'Version' },
  { label: 'First seen' },
  { label: 'Last seen', align: 'end', hideBelow: 'tablet' },
  { label: 'Requests', align: 'end' },
  { label: 'Error rate', align: 'end' },
  { label: 'P95', align: 'end' },
] as const satisfies readonly ColumnSpec[];

/** Versions side by side, so a deployment can be compared with the one before it. */
export function VersionTable({ versions }: { versions: readonly VersionSummary[] }) {
  const now = Date.now();
  return (
    <Table aria-label="Versions">
      <TableHead columns={COLUMNS} />
      <tbody>
        {versions.map((version, index) => (
          <Tr key={version.version}>
            <Td mono>
              {version.version}
              {index === 0 && <span className={styles.note}> latest</span>}
            </Td>
            <Td mono muted>
              {formatDateTime(version.firstSeenAt)}
            </Td>
            <Td align="end" mono muted hideBelow="tablet">
              {formatRelative(version.lastSeenAt, now)}
            </Td>
            <Td align="end" mono>
              {formatCount(version.requests)}
            </Td>
            <Td align="end" mono>
              {formatPercent(version.errorRate)}
            </Td>
            <Td align="end" mono>
              {formatLatency(version.p95Ms)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
