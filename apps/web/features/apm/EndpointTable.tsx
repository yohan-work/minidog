import type { EndpointSummary, TimeRange } from '@minidog/types';
import { RowLink, Table, TableHead, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { formatCount, formatLatency, formatPercent } from '@/lib/format';
import { tracesHref } from '@/lib/links';
import { errorRateTone, latencyTone, toneClass } from './ServiceTable';
import styles from './Apm.module.scss';

const COLUMNS = [
  { label: 'Endpoint' },
  { label: 'Requests', align: 'end' },
  { label: 'Error rate', align: 'end' },
  { label: 'P50', align: 'end', hideBelow: 'desktop' },
  { label: 'P95', align: 'end' },
  { label: 'P99', align: 'end', hideBelow: 'desktop' },
] as const satisfies readonly ColumnSpec[];

/** Slowest endpoints first; a row opens its traces. */
export function EndpointTable({ endpoints, range }: { endpoints: readonly EndpointSummary[]; range: TimeRange }) {
  return (
    <Table aria-label="Endpoints">
      <TableHead columns={COLUMNS} />
      <tbody>
        {endpoints.map((endpoint) => (
          <Tr key={endpoint.endpoint} interactive>
            <Td>
              <RowLink href={tracesHref({ service: endpoint.service, endpoint: endpoint.endpoint }, range)} className={styles.endpoint}>
                {endpoint.endpoint}
              </RowLink>
            </Td>
            <Td align="end" mono>
              {formatCount(endpoint.requests)}
            </Td>
            <Td align="end" mono className={toneClass(errorRateTone(endpoint.errorRate))}>
              {formatPercent(endpoint.errorRate)}
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatLatency(endpoint.p50Ms)}
            </Td>
            <Td align="end" mono className={toneClass(latencyTone(endpoint.p95Ms))}>
              {formatLatency(endpoint.p95Ms)}
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatLatency(endpoint.p99Ms)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
