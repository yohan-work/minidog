import { SERVICE_THRESHOLDS, type ServiceSummary, type TimeRange } from '@minidog/types';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { RowLink, Table, TableHead, TableSkeleton, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { formatLatency, formatPercent, formatRate } from '@/lib/format';
import { serviceHref } from '@/lib/links';
import styles from './Apm.module.scss';

const COLUMNS = [
  { label: 'Status' },
  { label: 'Service' },
  { label: 'Requests', align: 'end' },
  { label: 'Error rate', align: 'end' },
  { label: 'P50', align: 'end', hideBelow: 'desktop' },
  { label: 'P95', align: 'end' },
  { label: 'P99', align: 'end', hideBelow: 'desktop' },
] as const satisfies readonly ColumnSpec[];

export function errorRateTone(rate: number | null | undefined): 'warning' | 'error' | undefined {
  if (rate == null) return undefined;
  if (rate >= SERVICE_THRESHOLDS.errorRate.critical) return 'error';
  return rate >= SERVICE_THRESHOLDS.errorRate.degraded ? 'warning' : undefined;
}

export function latencyTone(ms: number | null | undefined): 'warning' | 'error' | undefined {
  if (ms == null) return undefined;
  if (ms >= SERVICE_THRESHOLDS.p95Ms.critical) return 'error';
  return ms >= SERVICE_THRESHOLDS.p95Ms.degraded ? 'warning' : undefined;
}

const toneClass = (tone: 'warning' | 'error' | undefined) => (tone ? styles[tone] : undefined);

export function ServiceTable({ services, range }: { services: readonly ServiceSummary[]; range: TimeRange }) {
  return (
    <Table aria-label="Services">
      <TableHead columns={COLUMNS} />
      <tbody>
        {services.map((service) => (
          <Tr key={service.service} interactive>
            <Td>
              <StatusIndicator status={service.health} />
            </Td>
            <Td>
              <RowLink href={serviceHref(service.service, range)}>{service.service}</RowLink>
            </Td>
            <Td align="end" mono>
              {formatRate(service.requestsPerSecond)}
            </Td>
            <Td align="end" mono className={toneClass(errorRateTone(service.errorRate))}>
              {formatPercent(service.errorRate)}
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatLatency(service.p50Ms)}
            </Td>
            <Td align="end" mono className={toneClass(latencyTone(service.p95Ms))}>
              {formatLatency(service.p95Ms)}
            </Td>
            <Td align="end" mono muted hideBelow="desktop">
              {formatLatency(service.p99Ms)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export function ServiceTableSkeleton() {
  return <TableSkeleton columns={COLUMNS} label="Loading services" />;
}

export { toneClass };
