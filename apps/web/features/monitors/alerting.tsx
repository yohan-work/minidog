import type { AlertMonitor, AlertMonitorType, AlertState, HostResourceMetric, TimeRange } from '@minidog/types';
import { StatusIndicator, type IndicatorStatus } from '@/components/observability/StatusIndicator';
import { EMPTY, formatCount, formatLatency } from '@/lib/format';
import { withRange } from '@/lib/range-href';

const STATE_STATUS: Record<AlertState, IndicatorStatus> = {
  ok: 'healthy',
  warning: 'degraded',
  critical: 'critical',
  no_data: 'unknown',
};

export const STATE_LABELS: Record<AlertState, string> = {
  ok: 'Healthy',
  warning: 'Warning',
  critical: 'Critical',
  no_data: 'No data',
};

export function AlertStateIndicator({ state, enabled = true }: { state: AlertState; enabled?: boolean }) {
  if (!enabled) return <StatusIndicator status="paused" />;
  return <StatusIndicator status={STATE_STATUS[state]} label={STATE_LABELS[state]} />;
}

export const TYPE_LABELS: Record<AlertMonitorType, string> = {
  service_down: 'Service down',
  error_rate: 'Error rate',
  latency: 'Latency',
  host_resource: 'CPU / Memory',
};

export const TYPE_DESCRIPTIONS: Record<AlertMonitorType, string> = {
  service_down: 'Alerts when a service receives fewer requests than the threshold in the window.',
  error_rate: 'Alerts when the share of failed requests reaches a percentage.',
  latency: 'Alerts when the P95 of server spans reaches a duration.',
  host_resource: 'Alerts when CPU, memory or disk utilization of a host reaches a percentage.',
};

export const RESOURCE_LABELS: Record<HostResourceMetric, string> = { cpu: 'CPU', memory: 'Memory', disk: 'Disk' };

export const THRESHOLD_UNITS: Record<AlertMonitorType, string> = {
  service_down: 'requests',
  error_rate: '%',
  latency: 'ms',
  host_resource: '%',
};

export function signalLabel(monitor: Pick<AlertMonitor, 'type' | 'metric'>): string {
  if (monitor.type === 'host_resource') return RESOURCE_LABELS[monitor.metric ?? 'cpu'];
  return { service_down: 'Requests', error_rate: 'Error rate', latency: 'P95' }[monitor.type];
}

export function formatAlertValue(type: AlertMonitorType, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  if (type === 'service_down') return `${formatCount(value)} req`;
  if (type === 'latency') return formatLatency(value);
  return `${value.toFixed(1)}%`;
}

/** `P95 ≥ 1.00 s warning, ≥ 2.00 s critical · 5 min` */
export function conditionText(monitor: Pick<AlertMonitor, 'type' | 'metric' | 'warningThreshold' | 'criticalThreshold' | 'windowMinutes'>): string {
  const format = (value: number) => formatAlertValue(monitor.type, value);
  const comparator = monitor.type === 'service_down' ? '<' : '≥';
  const parts = [
    monitor.warningThreshold !== null ? `${comparator} ${format(monitor.warningThreshold)} warning` : null,
    `${comparator} ${format(monitor.criticalThreshold)} critical`,
  ].filter(Boolean);
  return `${signalLabel(monitor)} ${parts.join(', ')} · ${monitor.windowMinutes} min`;
}

export const monitorHref = (id: string, range: TimeRange) => withRange(`/monitors/${id}`, range);
