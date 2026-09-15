import {
  alertDirection,
  isHostResourceMetric,
  isSyntheticAlertMetric,
  usesWindow,
  type AlertDirection,
  type AlertMetric,
  type AlertMonitorType,
  type AlertState,
  type HostResourceMetric,
  type SyntheticAlertMetric,
} from '@minidog/types';

export interface Thresholds {
  warning: number | null;
  critical: number;
}

export type Direction = AlertDirection;

/** What a monitor measures. */
export interface Signal {
  type: AlertMonitorType;
  metric: AlertMetric | null;
}

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
const SYNTHETIC_LABELS: Record<SyntheticAlertMetric, string> = {
  failure_rate: 'Failed checks',
  response_time: 'Response time',
  ssl_days: 'SSL expiry',
};

export function signalLabel({ type, metric }: Signal): string {
  switch (type) {
    case 'service_down':
      return 'Requests';
    case 'error_rate':
      return 'Error rate';
    case 'latency':
      return 'P95';
    case 'host_resource':
      return RESOURCE_LABELS[isHostResourceMetric(metric) ? metric : 'cpu'];
    case 'synthetic_check':
      return SYNTHETIC_LABELS[isSyntheticAlertMetric(metric) ? metric : 'failure_rate'];
  }
}

const formatMs = (value: number) => (value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`);

function formatDays(days: number): string {
  if (days <= 0) return 'expired';
  const whole = Math.floor(days);
  return whole === 1 ? '1 day' : `${whole} days`;
}

export function formatAlertValue(signal: Signal, value: number): string {
  switch (signal.type) {
    case 'service_down':
      return `${Math.round(value)}`;
    case 'latency':
      return formatMs(value);
    case 'synthetic_check':
      if (signal.metric === 'response_time') return formatMs(value);
      if (signal.metric === 'ssl_days') return formatDays(value);
      return `${value.toFixed(1)}%`;
    default:
      return `${value.toFixed(1)}%`;
  }
}

export interface MessageInput extends Signal {
  windowMinutes: number;
  thresholds: Thresholds;
}

function noDataMessage(signal: Signal, window: string): string {
  if (signal.type !== 'synthetic_check') return `No data in the ${window}`;
  if (signal.metric === 'ssl_days') return 'No SSL certificate in recent checks';
  if (signal.metric === 'response_time') return `No successful checks in the ${window}`;
  return `No checks in the ${window}`;
}

/** One line explaining the state, e.g. `P95 1.42 s ≥ warning 1.00 s (last 5 min)`. */
export function alertMessage(monitor: MessageInput, state: AlertState, value: number | null): string {
  const window = `last ${monitor.windowMinutes} min`;
  if (state === 'no_data' || value === null) return noDataMessage(monitor, window);
  if (monitor.type === 'service_down' && state === 'critical' && value === 0) return `No requests in the ${window}`;
  if (monitor.type === 'synthetic_check' && monitor.metric === 'ssl_days' && value <= 0)
    return 'SSL certificate expired';

  const scope = usesWindow(monitor.type, monitor.metric) ? ` (${window})` : '';
  const format = (amount: number) => formatAlertValue(monitor, amount);
  const current = `${signalLabel(monitor)} ${format(value)}`;
  const comparator = alertDirection(monitor.type, monitor.metric) === 'above' ? '≥' : '<';
  if (state === 'critical') return `${current} ${comparator} critical ${format(monitor.thresholds.critical)}${scope}`;
  if (state === 'warning' && monitor.thresholds.warning !== null) {
    return `${current} ${comparator} warning ${format(monitor.thresholds.warning)}${scope}`;
  }
  return `${current} within thresholds${scope}`;
}

/** States that notify when entered or left. */
export const isAlerting = (state: AlertState) => state === 'warning' || state === 'critical';

// No data and Healthy are equally quiet: moving between them is never delayed.
const SEVERITY: Record<AlertState, number> = { ok: 0, no_data: 0, warning: 1, critical: 2 };

export interface PendingTransition {
  state: AlertState;
  /** ISO time the measurements started pointing this way. */
  since: string;
}

export interface DelayInput {
  stored: AlertState;
  pending: PendingTransition | null;
  /** State the latest measurement points to. */
  derived: AlertState;
  at: Date;
  alertAfterMinutes: number;
  recoverAfterMinutes: number;
  /** Previous evaluation (ISO). A pending clock only keeps running across consecutive evaluations. */
  lastEvaluatedAt: string | null;
  /** Longest gap between evaluations that still counts as consecutive. */
  maxGapMs: number;
}

/**
 * Noise control: a worse state is entered only after it has lasted
 * `alertAfterMinutes`, a better one after `recoverAfterMinutes`. The clock
 * keeps running while measurements move the same way (e.g. warning, then
 * critical) and restarts when they reverse — or when evaluations stopped for
 * a while (paused, ClickHouse outage): time nobody measured never counts.
 */
export function applyTransitionDelay(input: DelayInput): { state: AlertState; pending: PendingTransition | null } {
  const { stored, pending, derived, at } = input;
  const direction = Math.sign(SEVERITY[derived] - SEVERITY[stored]);
  if (derived === stored) return { state: stored, pending: null };

  const delayMinutes = direction > 0 ? input.alertAfterMinutes : direction < 0 ? input.recoverAfterMinutes : 0;
  if (delayMinutes <= 0) return { state: derived, pending: null };

  const measuredWithoutGap =
    input.lastEvaluatedAt !== null && at.getTime() - Date.parse(input.lastEvaluatedAt) <= input.maxGapMs;
  const continues =
    pending !== null && measuredWithoutGap && Math.sign(SEVERITY[pending.state] - SEVERITY[stored]) === direction;
  const since = continues ? pending.since : at.toISOString();
  if (at.getTime() - Date.parse(since) >= delayMinutes * 60_000) return { state: derived, pending: null };
  return { state: stored, pending: { state: derived, since } };
}

export function isMuted(mutedUntil: string | null, now: number): boolean {
  return mutedUntil !== null && Date.parse(mutedUntil) > now;
}
