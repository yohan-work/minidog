import {
  alertDefaults,
  alertDirection,
  isHostResourceMetric,
  isSyntheticAlertMetric,
  type AlertMetric,
  type AlertMonitorListResponse,
  type AlertMonitorResponse,
  type AlertMonitorType,
  type AlertSummaryResponse,
  type CreateAlertMonitorInput,
  type UpdateAlertMonitorInput,
} from '@minidog/types';
import { z } from 'zod';
import { NotFoundError } from '../lib/errors';
import {
  publicMonitor,
  type AlertMonitorRepository,
  type ScopedAlertMonitor,
} from '../repositories/alert-monitor-repository';
import type { MonitorRepository } from '../repositories/monitor-repository';
import type { Scope } from '../repositories/project-repository';
import type { AlertEvaluator } from '../worker/alert-evaluator';
import { signalLabel, thresholdsInOrder } from './alert-state';

const SEVERITY = { critical: 0, warning: 1 } as const;

function issue(path: string, message: string): z.ZodError {
  return new z.ZodError([{ code: 'custom', input: undefined, path: [path], message }]);
}

const orderIssue = () => issue('warningThreshold', 'The warning threshold must trip before the critical threshold.');

/** The metric a type measures; host_resource and synthetic_check choose one, other types have none. */
function resolveMetric(type: AlertMonitorType, metric: AlertMetric | undefined): AlertMetric | null {
  if (type === 'host_resource') {
    const resolved = metric ?? 'cpu';
    if (!isHostResourceMetric(resolved)) throw issue('metric', 'Choose CPU, memory or disk.');
    return resolved;
  }
  if (type === 'synthetic_check') {
    const resolved = metric ?? 'failure_rate';
    if (!isSyntheticAlertMetric(resolved)) throw issue('metric', 'Choose failed checks, response time or SSL expiry.');
    return resolved;
  }
  return null;
}

export class AlertingService {
  constructor(
    private readonly monitors: AlertMonitorRepository,
    private readonly evaluator: AlertEvaluator,
    private readonly scope: Scope,
    /** ALERTS_ENABLED: evaluate monitors right after they are saved. */
    private readonly automaticEvaluation: boolean,
    /** Targets of synthetic_check monitors. */
    private readonly syntheticMonitors: MonitorRepository,
  ) {}

  list(): AlertMonitorListResponse {
    return { monitors: this.monitors.list(this.scope).map(publicMonitor) };
  }

  detail(id: string): AlertMonitorResponse {
    const monitor = this.get(id);
    return { monitor: publicMonitor(monitor), events: this.monitors.eventsForMonitor(id, 100) };
  }

  /** Creates the monitor and evaluates it right away, so it never waits an interval for a state. */
  async create(input: CreateAlertMonitorInput): Promise<ScopedAlertMonitor> {
    const metric = resolveMetric(input.type, input.metric);
    const defaults = alertDefaults(input.type, metric);

    let targetLabel = input.target;
    if (input.type === 'synthetic_check') {
      const check = this.syntheticMonitors.getInScope(this.scope, input.target);
      if (!check) throw issue('target', 'Choose a synthetic monitor in this environment.');
      targetLabel = check.name;
    }

    const thresholds = {
      warning: input.warningThreshold === undefined ? defaults.warning : input.warningThreshold,
      critical: input.criticalThreshold ?? defaults.critical,
    };
    if (!thresholdsInOrder(thresholds, alertDirection(input.type, metric))) throw orderIssue();

    const monitor = this.monitors.create(this.scope, {
      name: input.name || `${signalLabel({ type: input.type, metric })} · ${targetLabel}`,
      type: input.type,
      target: input.target,
      metric,
      warningThreshold: thresholds.warning,
      criticalThreshold: thresholds.critical,
      windowMinutes: input.windowMinutes ?? defaults.windowMinutes,
      webhookUrl: input.webhookUrl ?? '',
      alertAfterMinutes: input.alertAfterMinutes ?? 0,
      recoverAfterMinutes: input.recoverAfterMinutes ?? 0,
    });
    return this.evaluateNow(monitor);
  }

  /** New thresholds or a resume take effect immediately rather than at the next interval. */
  async update(id: string, patch: UpdateAlertMonitorInput): Promise<ScopedAlertMonitor> {
    const current = this.get(id);
    const thresholds = {
      warning: patch.warningThreshold === undefined ? current.warningThreshold : patch.warningThreshold,
      critical: patch.criticalThreshold ?? current.criticalThreshold,
    };
    if (!thresholdsInOrder(thresholds, alertDirection(current.type, current.metric))) throw orderIssue();
    const monitor = this.monitors.update(id, patch)!;
    return monitor.enabled ? this.evaluateNow(monitor) : monitor;
  }

  /** Holds webhooks for `minutes`; states keep being evaluated and recorded. */
  mute(id: string, minutes: number): ScopedAlertMonitor {
    this.get(id);
    return this.monitors.update(id, { mutedUntil: new Date(Date.now() + minutes * 60_000).toISOString() })!;
  }

  /** Ends a mute early; a notification held during it is sent if its state is still current. */
  async unmute(id: string): Promise<ScopedAlertMonitor> {
    this.get(id);
    const monitor = this.monitors.update(id, { mutedUntil: null })!;
    return monitor.enabled ? this.evaluateNow(monitor) : monitor;
  }

  /**
   * The change is already saved, so a failed evaluation must not fail the
   * request (a retry would create a duplicate); the next interval tries again.
   * With ALERTS_ENABLED=false nothing is evaluated automatically, or notified.
   */
  private async evaluateNow(monitor: ScopedAlertMonitor): Promise<ScopedAlertMonitor> {
    return this.automaticEvaluation ? this.evaluator.evaluateQuietly(monitor) : monitor;
  }

  delete(id: string): void {
    this.get(id);
    this.monitors.delete(id);
  }

  /** Evaluates immediately instead of waiting for the next interval. */
  async evaluate(id: string): Promise<AlertMonitorResponse> {
    await this.evaluator.evaluate(this.get(id));
    return this.detail(id);
  }

  summary(): AlertSummaryResponse {
    const active = this.monitors
      .list(this.scope)
      .filter((monitor) => monitor.enabled && (monitor.state === 'critical' || monitor.state === 'warning'))
      .sort((a, b) => SEVERITY[a.state as keyof typeof SEVERITY] - SEVERITY[b.state as keyof typeof SEVERITY])
      .map(publicMonitor);
    return {
      active,
      unread: this.monitors.unreadCount(this.scope),
      recent: this.monitors.recentEvents(this.scope, 50),
    };
  }

  acknowledgeAll(): void {
    this.monitors.acknowledgeAll(this.scope);
  }

  private get(id: string): ScopedAlertMonitor {
    const monitor = this.monitors.getInScope(this.scope, id);
    if (!monitor) throw new NotFoundError('Monitor');
    return monitor;
  }
}
