import {
  ALERT_DELAYS_MINUTES,
  ALERT_WINDOWS_MINUTES,
  alertDirection,
  isHostResourceMetric,
  isSyntheticAlertMetric,
  usesWindow,
  type AlertMonitor,
  type AlertMonitorType,
  type AlertState,
  type HostResourceMetric,
  type SyntheticAlertMetric,
  type TimeRange,
} from '@minidog/types';
import { StatusIndicator, type IndicatorStatus } from '@/components/observability/StatusIndicator';
import { EMPTY, formatCount, formatLatency } from '@/lib/format';
import { serviceHref } from '@/lib/links';
import { withRange } from '@/lib/range-href';
import { hostHref } from '../infrastructure/host';

/** What a monitor measures. */
export type AlertSignal = Pick<AlertMonitor, 'type' | 'metric'>;

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

const STATE_SEVERITY: Record<AlertState, number> = { ok: 0, no_data: 0, warning: 1, critical: 2 };

/** True when `to` is worse than `from` (alert after applies), false for a recovery. */
export const isEscalation = (from: AlertState, to: AlertState) => STATE_SEVERITY[to] > STATE_SEVERITY[from];

export const TYPE_LABELS: Record<AlertMonitorType, string> = {
  service_down: 'Service down',
  error_rate: 'Error rate',
  latency: 'Latency',
  host_resource: 'CPU / Memory',
  synthetic_check: 'Synthetic check',
};

export const TYPE_DESCRIPTIONS: Record<AlertMonitorType, string> = {
  service_down:
    'Alerts when a service that had been receiving requests stops. It cannot tell a service that died while already quiet from one that simply has no visitors, and reports neither — for an app with little traffic, a URL check in Synthetics is the signal that works.',
  error_rate: 'Alerts when the share of failed requests reaches a percentage.',
  latency: 'Alerts when the P95 of server spans reaches a duration.',
  host_resource: 'Alerts when CPU, memory or disk utilization of a host reaches a percentage.',
  synthetic_check:
    'Alerts when a URL check from Synthetics fails, slows down or its SSL certificate is about to expire.',
};

export const RESOURCE_LABELS: Record<HostResourceMetric, string> = { cpu: 'CPU', memory: 'Memory', disk: 'Disk' };

export const SYNTHETIC_METRIC_LABELS: Record<SyntheticAlertMetric, string> = {
  failure_rate: 'Failed checks',
  response_time: 'Response time (P95)',
  ssl_days: 'SSL expiry',
};

export const SYNTHETIC_METRIC_DESCRIPTIONS: Record<SyntheticAlertMetric, string> = {
  failure_rate: 'Share of failed checks in the window.',
  response_time: 'P95 response time of passing checks in the window.',
  ssl_days: 'Days until the certificate seen by the latest check expires.',
};

export function thresholdUnit({ type, metric }: AlertSignal): string {
  switch (type) {
    case 'service_down':
      return 'requests';
    case 'latency':
      return 'ms';
    case 'synthetic_check':
      return metric === 'response_time' ? 'ms' : metric === 'ssl_days' ? 'days' : '%';
    default:
      return '%';
  }
}

export function signalLabel({ type, metric }: AlertSignal): string {
  if (type === 'host_resource') return RESOURCE_LABELS[isHostResourceMetric(metric) ? metric : 'cpu'];
  if (type === 'synthetic_check') {
    const labels: Record<SyntheticAlertMetric, string> = {
      failure_rate: 'Failed checks',
      response_time: 'Response time',
      ssl_days: 'SSL expiry',
    };
    return labels[isSyntheticAlertMetric(metric) ? metric : 'failure_rate'];
  }
  return { service_down: 'Requests', error_rate: 'Error rate', latency: 'P95' }[type];
}

export function formatAlertValue(signal: AlertSignal, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  switch (signal.type) {
    case 'service_down':
      return `${formatCount(value)} req`;
    case 'latency':
      return formatLatency(value);
    case 'synthetic_check': {
      if (signal.metric === 'response_time') return formatLatency(value);
      if (signal.metric !== 'ssl_days') return `${value.toFixed(1)}%`;
      if (value <= 0) return 'Expired';
      const days = Math.floor(value);
      return days === 1 ? '1 day' : `${days} days`;
    }
    default:
      return `${value.toFixed(1)}%`;
  }
}

/** `P95 ≥ 1.00 s warning, ≥ 2.00 s critical · 5 min · for 5 min` */
export function conditionText(
  monitor: AlertSignal &
    Pick<AlertMonitor, 'warningThreshold' | 'criticalThreshold' | 'windowMinutes' | 'alertAfterMinutes'>,
): string {
  const format = (value: number) => formatAlertValue(monitor, value);
  const comparator = alertDirection(monitor.type, monitor.metric) === 'below' ? '<' : '≥';
  const parts = [
    monitor.warningThreshold !== null ? `${comparator} ${format(monitor.warningThreshold)} warning` : null,
    `${comparator} ${format(monitor.criticalThreshold)} critical`,
  ].filter(Boolean);
  const window = usesWindow(monitor.type, monitor.metric) ? ` · ${monitor.windowMinutes} min` : '';
  const delay = monitor.alertAfterMinutes > 0 ? ` · for ${monitor.alertAfterMinutes} min` : '';
  return `${signalLabel(monitor)} ${parts.join(', ')}${window}${delay}`;
}

export function delayLabel(minutes: number): string {
  return minutes === 0 ? 'Immediately' : `After ${minutes} min`;
}

export function muteLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
}

export function isMutedNow(monitor: Pick<AlertMonitor, 'mutedUntil'>, now: number = Date.now()): boolean {
  return monitor.mutedUntil !== null && Date.parse(monitor.mutedUntil) > now;
}

export function DelayOptions() {
  return (
    <>
      {ALERT_DELAYS_MINUTES.map((minutes) => (
        <option key={minutes} value={minutes}>
          {delayLabel(minutes)}
        </option>
      ))}
    </>
  );
}

export function WindowOptions() {
  return (
    <>
      {ALERT_WINDOWS_MINUTES.map((minutes) => (
        <option key={minutes} value={minutes}>
          Last {minutes} min
        </option>
      ))}
    </>
  );
}

export const monitorHref = (id: string, range: TimeRange) => withRange(`/monitors/${id}`, range);

/** Where the monitored signal comes from: a service, a host or a synthetic monitor. */
export function targetHref(monitor: Pick<AlertMonitor, 'type' | 'target'>, range: TimeRange): string {
  if (monitor.type === 'host_resource') return hostHref(monitor.target, range);
  if (monitor.type === 'synthetic_check') return withRange(`/synthetics/${encodeURIComponent(monitor.target)}`, range);
  return serviceHref(monitor.target, range);
}
