import type { CheckStatus, HealthStatus, MonitorWithSummary } from '@minidog/types';
import { cx } from '@/lib/cx';
import styles from './StatusIndicator.module.scss';

export type IndicatorStatus = HealthStatus | CheckStatus | 'paused';

const LABELS: Record<IndicatorStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',
  unknown: 'Unknown',
  paused: 'Paused',
  up: 'Up',
  down: 'Down',
};

interface StatusIndicatorProps {
  status: IndicatorStatus;
  /** Overrides the default label; a text label is always rendered. */
  label?: string;
  className?: string;
}

/**
 * Status is never color-only: each state has its own shape plus a text label.
 * ● healthy/up · ▲ degraded · ◆ critical/down · ○ unknown · ‖ paused
 */
export function StatusIndicator({ status, label, className }: StatusIndicatorProps) {
  return (
    <span className={cx(styles.indicator, className)} data-status={status}>
      <span className={styles.shape} aria-hidden />
      <span className={styles.label}>{label ?? LABELS[status]}</span>
    </span>
  );
}

export function monitorStatus(monitor: Pick<MonitorWithSummary, 'enabled' | 'summary'>): IndicatorStatus {
  return monitor.enabled ? monitor.summary.health : 'paused';
}
