import type { TimeRange, TraceSummary } from '@minidog/types';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { RowLink, Table, TableHead, TableSkeleton, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { formatDateTime, formatLatency, formatTimeMs } from '@/lib/format';
import { traceHref } from '@/lib/links';
import { latencyTone, toneClass } from './ServiceTable';
import styles from './Apm.module.scss';

const COLUMNS = [
  { label: 'Time' },
  { label: 'Service', hideBelow: 'tablet' },
  { label: 'Name' },
  { label: 'Duration', align: 'end' },
  { label: 'Status', align: 'end' },
] as const satisfies readonly ColumnSpec[];

/** Dense list of requests; a row opens the trace with the listed span selected. */
export function TraceTable({
  traces,
  range,
  label,
}: {
  traces: readonly TraceSummary[];
  range: TimeRange;
  label: string;
}) {
  return (
    <Table aria-label={label}>
      <TableHead columns={COLUMNS} />
      <tbody>
        {traces.map((trace) => (
          <Tr key={`${trace.traceId}-${trace.spanId}`} interactive>
            <Td mono muted>
              <time dateTime={new Date(trace.timestamp).toISOString()} title={formatDateTime(trace.timestamp)}>
                {formatTimeMs(trace.timestamp)}
              </time>
            </Td>
            <Td hideBelow="tablet">{trace.service}</Td>
            <Td>
              <RowLink
                href={traceHref(trace.traceId, range, trace.spanId, trace.timestamp)}
                className={styles.traceName}
              >
                {trace.name}
              </RowLink>
            </Td>
            <Td align="end" mono className={toneClass(latencyTone(trace.durationMs))}>
              {formatLatency(trace.durationMs)}
            </Td>
            <Td align="end" mono>
              {trace.error ? (
                <StatusIndicator status="down" label={trace.httpStatus ? `Error ${trace.httpStatus}` : 'Error'} />
              ) : (
                (trace.httpStatus ?? 'OK')
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export function TraceTableSkeleton({ rows }: { rows?: number }) {
  return <TableSkeleton columns={COLUMNS} rows={rows} label="Loading traces" />;
}
