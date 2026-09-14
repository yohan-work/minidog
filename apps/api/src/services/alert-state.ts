import type { AlertMonitorType, AlertState, HostResourceMetric } from '@minidog/types';

export interface Thresholds {
  warning: number | null;
  critical: number;
}

/**
 * `above`: alert when the value rises to a threshold (error rate, latency,
 * utilization). `below`: alert when it falls under it (requests for Service Down).
 */
export type Direction = 'above' | 'below';

export const DIRECTIONS: Record<AlertMonitorType, Direction> = {
  service_down: 'below',
  error_rate: 'above',
  latency: 'above',
  host_resource: 'above',
};

export function deriveAlertState(value: number | null, thresholds: Thresholds, direction: Direction): AlertState {
  if (value === null) return 'no_data';
  const breaches = (threshold: number) => (direction === 'above' ? value >= threshold : value < threshold);
  if (breaches(thresholds.critical)) return 'critical';
  if (thresholds.warning !== null && breaches(thresholds.warning)) return 'warning';
  return 'ok';
}

/** Warning must trip before critical in the direction of the alert. */
export function thresholdsInOrder(thresholds: Thresholds, direction: Direction): boolean {
  if (thresholds.warning === null) return true;
  return direction === 'above' ? thresholds.warning < thresholds.critical : thresholds.warning > thresholds.critical;
}

const RESOURCE_LABELS: Record<HostResourceMetric, string> = { cpu: 'CPU', memory: 'Memory', disk: 'Disk' };

export function signalLabel(type: AlertMonitorType, metric: HostResourceMetric | null): string {
  switch (type) {
    case 'service_down':
      return 'Requests';
    case 'error_rate':
      return 'Error rate';
    case 'latency':
      return 'P95';
    case 'host_resource':
      return RESOURCE_LABELS[metric ?? 'cpu'];
  }
}

export function formatAlertValue(type: AlertMonitorType, value: number): string {
  if (type === 'service_down') return `${Math.round(value)}`;
  if (type === 'latency') return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(1)}%`;
}

export interface MessageInput {
  type: AlertMonitorType;
  metric: HostResourceMetric | null;
  windowMinutes: number;
  thresholds: Thresholds;
}

/** One line explaining the state, e.g. `P95 1.42 s ≥ warning 1.00 s (last 5 min)`. */
export function alertMessage(monitor: MessageInput, state: AlertState, value: number | null): string {
  const window = `last ${monitor.windowMinutes} min`;
  if (state === 'no_data' || value === null) return `No data in the ${window}`;
  if (monitor.type === 'service_down' && state === 'critical' && value === 0) return `No requests in the ${window}`;

  const label = signalLabel(monitor.type, monitor.metric);
  const current = `${label} ${formatAlertValue(monitor.type, value)}`;
  const comparator = DIRECTIONS[monitor.type] === 'above' ? '≥' : '<';
  if (state === 'critical') {
    return `${current} ${comparator} critical ${formatAlertValue(monitor.type, monitor.thresholds.critical)} (${window})`;
  }
  if (state === 'warning' && monitor.thresholds.warning !== null) {
    return `${current} ${comparator} warning ${formatAlertValue(monitor.type, monitor.thresholds.warning)} (${window})`;
  }
  return `${current} within thresholds (${window})`;
}

/** States that notify when entered or left. */
export const isAlerting = (state: AlertState) => state === 'warning' || state === 'critical';
