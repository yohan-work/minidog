import type { DbQuerySummary, TimeRange } from '@minidog/types';
import { RowLink, Table, TableHead, TableSkeleton, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { EMPTY, formatCount, formatLatency, formatPercent } from '@/lib/format';
import { traceHref } from '@/lib/links';
import styles from './Queries.module.scss';

const COLUMNS = [
  { label: 'Statement' },
  { label: 'Calls', align: 'end' },
  { label: 'Time spent', align: 'end' },
  { label: 'Avg', align: 'end', hideBelow: 'tablet' },
  { label: 'P95', align: 'end' },
  { label: 'Max', align: 'end', hideBelow: 'desktop' },
  { label: 'Errors', align: 'end', hideBelow: 'tablet' },
] as const satisfies readonly ColumnSpec[];

/** One row per statement shape; the row opens the slowest call in its trace. */
export function QueryTable({
  queries,
  range,
  showService = true,
}: {
  queries: readonly DbQuerySummary[];
  range: TimeRange;
  showService?: boolean;
}) {
  return (
    <Table aria-label="Database queries">
      <TableHead columns={COLUMNS} />
      <tbody>
        {queries.map((query) => (
          <Tr key={`${query.service}\n${query.dbSystem}\n${query.statement}`} interactive>
            <Td>
              <span className={styles.query}>
                <RowLink
                  href={traceHref(query.slowestTraceId, range, query.slowestSpanId)}
                  className={styles.statement}
                  title={query.statement}
                >
                  {query.statement}
                </RowLink>
                <span className={styles.meta}>
                  {[showService ? query.service : null, query.dbSystem, query.collection || null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </Td>
            <Td align="end" mono>
              {formatCount(query.calls)}
            </Td>
            <Td align="end" mono>
              {formatLatency(query.totalMs)}
            </Td>
            <Td align="end" mono muted hideBelow="tablet">
              {formatLatency(query.avgMs)}
            </Td>
            <Td align="end" mono>
              {formatLatency(query.p95Ms)}
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatLatency(query.maxMs)}
            </Td>
            <Td align="end" mono muted hideBelow="tablet" className={query.errors > 0 ? styles.error : undefined}>
              {query.errors > 0 ? `${formatCount(query.errors)} (${formatPercent(query.errorRate)})` : EMPTY}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export function QueryTableSkeleton({ rows }: { rows?: number }) {
  return <TableSkeleton columns={COLUMNS} rows={rows} label="Loading queries" />;
}
