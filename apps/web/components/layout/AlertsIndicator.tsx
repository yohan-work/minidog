'use client';

import type { AlertSummaryResponse } from '@minidog/types';
import Link from 'next/link';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import styles from './TopBar.module.scss';

/**
 * Dashboard notification: active alerts, or unread state changes, link to
 * Monitors. Nothing is shown while everything is healthy and read.
 */
export function AlertsIndicator() {
  const range = useTimeRange();
  const { data } = useApi<AlertSummaryResponse>('/alerting/summary', 15_000);
  if (!data) return null;

  const critical = data.active.filter((monitor) => monitor.state === 'critical').length;
  const active = data.active.length;
  if (active === 0 && data.unread === 0) return null;

  const label =
    active > 0
      ? `${active} alert${active === 1 ? '' : 's'}`
      : `${data.unread} new state change${data.unread === 1 ? '' : 's'}`;

  return (
    <Link href={withRange('/monitors', range)} className={styles.alerts} aria-label={`${label}. Open Monitors.`}>
      {active > 0 ? (
        <StatusIndicator status={critical > 0 ? 'critical' : 'degraded'} label={label} />
      ) : (
        <span className={styles.unread}>{label}</span>
      )}
    </Link>
  );
}
