import {
  ALERT_MONITOR_DEFAULTS,
  type AlertMonitorListResponse,
  type AlertMonitorResponse,
  type AlertSummaryResponse,
  type CreateAlertMonitorInput,
  type UpdateAlertMonitorInput,
} from '@minidog/types';
import { z } from 'zod';
import { ClickHouseUnavailableError, NotFoundError } from '../lib/errors';
import {
  publicMonitor,
  type AlertMonitorRepository,
  type ScopedAlertMonitor,
} from '../repositories/alert-monitor-repository';
import type { Scope } from '../repositories/project-repository';
import type { AlertEvaluator } from '../worker/alert-evaluator';
import { DIRECTIONS, signalLabel, thresholdsInOrder } from './alert-state';

const SEVERITY = { critical: 0, warning: 1 } as const;

function orderIssue(path: string): z.ZodError {
  return new z.ZodError([
    {
      code: 'custom',
      input: undefined,
      path: [path],
      message: 'The warning threshold must trip before the critical threshold.',
    },
  ]);
}

export class AlertingService {
  constructor(
    private readonly monitors: AlertMonitorRepository,
    private readonly evaluator: AlertEvaluator,
    private readonly scope: Scope,
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
    const defaults = ALERT_MONITOR_DEFAULTS[input.type];
    const metric = input.type === 'host_resource' ? (input.metric ?? 'cpu') : null;
    const thresholds = {
      warning: input.warningThreshold === undefined ? defaults.warning : input.warningThreshold,
      critical: input.criticalThreshold ?? defaults.critical,
    };
    if (!thresholdsInOrder(thresholds, DIRECTIONS[input.type])) throw orderIssue('warningThreshold');

    const monitor = this.monitors.create(this.scope, {
      name: input.name || `${signalLabel(input.type, metric)} · ${input.target}`,
      type: input.type,
      target: input.target,
      metric,
      warningThreshold: thresholds.warning,
      criticalThreshold: thresholds.critical,
      windowMinutes: input.windowMinutes ?? defaults.windowMinutes,
      webhookUrl: input.webhookUrl ?? '',
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
    if (!thresholdsInOrder(thresholds, DIRECTIONS[current.type])) throw orderIssue('warningThreshold');
    const monitor = this.monitors.update(id, patch)!;
    return monitor.enabled ? this.evaluateNow(monitor) : monitor;
  }

  /** While ClickHouse is unreachable the monitor keeps its state until the next interval. */
  private async evaluateNow(monitor: ScopedAlertMonitor): Promise<ScopedAlertMonitor> {
    try {
      return await this.evaluator.evaluate(monitor);
    } catch (error) {
      if (error instanceof ClickHouseUnavailableError) return monitor;
      throw error;
    }
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
