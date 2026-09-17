import type { AlertEvent, TimeRange } from '@minidog/types';
import { RowLink, Table, TableHead, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { EMPTY, formatDateTime } from '@/lib/format';
import { AlertStateIndicator, formatAlertValue, monitorHref, type AlertSignal } from './alerting';
import styles from './Monitors.module.scss';

function deliveryStatus(event: AlertEvent): string {
  const parts: string[] = [];
  if (event.webhookStatus) parts.push(`webhook ${event.webhookStatus}`);
  if (event.emailStatus) parts.push(`email ${event.emailStatus}`);
  return parts.join(' · ');
}

const COLUMNS = [
  { label: 'Time' },
  { label: 'Monitor' },
  { label: 'Change' },
  { label: 'Value', align: 'end', hideBelow: 'tablet' },
  { label: 'Message', hideBelow: 'desktop' },
  { label: 'Delivery', hideBelow: 'desktop' },
] as const satisfies readonly ColumnSpec[];

const COLUMNS_FOR_MONITOR = COLUMNS.filter((column) => column.label !== 'Monitor');

interface AlertEventTableProps {
  events: readonly AlertEvent[];
  range: TimeRange;
  /** Monitor signals by id, to format values; omit the monitor column on a monitor page. */
  types: ReadonlyMap<string, AlertSignal>;
  showMonitor?: boolean;
}

/** State change history — also the dashboard notification list. */
export function AlertEventTable({ events, range, types, showMonitor = true }: AlertEventTableProps) {
  return (
    <Table aria-label="Alert history">
      <TableHead columns={showMonitor ? COLUMNS : COLUMNS_FOR_MONITOR} />
      <tbody>
        {events.map((event) => {
          const signal = types.get(event.monitorId);
          return (
            <Tr key={event.id} interactive={showMonitor}>
              <Td mono muted>
                <span className={styles.transition}>
                  {formatDateTime(Date.parse(event.createdAt))}
                  {!event.acknowledged && <span className={styles.unread}>New</span>}
                </span>
              </Td>
              {showMonitor && (
                <Td>
                  <RowLink href={monitorHref(event.monitorId, range)}>{event.monitorName}</RowLink>
                </Td>
              )}
              <Td>
                <span className={styles.transition}>
                  <AlertStateIndicator state={event.fromState} />
                  <span className={styles.arrow} role="img" aria-label="to">
                    →
                  </span>
                  <AlertStateIndicator state={event.toState} />
                </span>
              </Td>
              <Td align="end" mono hideBelow="tablet">
                {signal ? formatAlertValue(signal, event.value) : EMPTY}
              </Td>
              <Td hideBelow="desktop">
                <span className={styles.message} title={event.message}>
                  {event.message}
                </span>
              </Td>
              <Td
                mono
                muted
                hideBelow="desktop"
                className={
                  event.webhookStatus.startsWith('failed') || event.emailStatus.startsWith('failed')
                    ? styles.error
                    : undefined
                }
              >
                {deliveryStatus(event) || EMPTY}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
