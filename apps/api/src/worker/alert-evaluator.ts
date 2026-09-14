import type { FastifyBaseLogger } from 'fastify';
import { ClickHouseUnavailableError } from '../lib/errors';
import type { AlertMonitorRepository, ScopedAlertMonitor } from '../repositories/alert-monitor-repository';
import { publicMonitor } from '../repositories/alert-monitor-repository';
import type { MetricRepository } from '../repositories/metric-repository';
import type { SpanRepository } from '../repositories/span-repository';
import { alertMessage, deriveAlertState, DIRECTIONS, isAlerting } from '../services/alert-state';
import { sendWebhook, webhookPayload } from '../services/webhook';

export interface AlertEvaluatorDeps {
  monitors: AlertMonitorRepository;
  spans: SpanRepository;
  metrics: MetricRepository;
  log: FastifyBaseLogger;
  intervalMs: number;
}

/**
 * Threshold engine: measures every enabled monitor on an interval, stores the
 * state, records state changes as events and delivers them to webhooks.
 * While ClickHouse is unreachable, states are left unchanged.
 */
export class AlertEvaluator {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  private unavailable = false;

  constructor(private readonly deps: AlertEvaluatorDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.evaluateAll(), this.deps.intervalMs);
    // First pass shortly after startup, once ClickHouse had a chance to connect.
    setTimeout(() => void this.evaluateAll(), 3_000).unref();
    this.deps.log.info({ intervalMs: this.deps.intervalMs }, 'Alert evaluator started');
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** One pass at a time; a call during a pass joins it. */
  evaluateAll(): Promise<void> {
    if (this.running) return this.running;
    // `.finally` always runs asynchronously, so `running` is set before it is cleared,
    // even when there is nothing to evaluate.
    const run = this.evaluateEnabled().finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  private async evaluateEnabled(): Promise<void> {
    for (const monitor of this.deps.monitors.listEnabled()) await this.evaluateQuietly(monitor);
  }

  /**
   * Measures one monitor now. The stored monitor is read again before and after
   * measuring: a pass works from a list loaded seconds earlier, and thresholds,
   * pausing or the webhook may have changed since. Throws
   * ClickHouseUnavailableError when telemetry cannot be queried.
   */
  async evaluate(monitor: ScopedAlertMonitor): Promise<ScopedAlertMonitor> {
    const measured = this.deps.monitors.get(monitor.id);
    if (!measured?.enabled) return measured ?? monitor;

    let value: number | null;
    try {
      value = await this.measure(measured);
      if (this.unavailable) this.deps.log.info('Alert evaluation resumed');
      this.unavailable = false;
    } catch (error) {
      if (error instanceof ClickHouseUnavailableError && !this.unavailable) {
        this.unavailable = true;
        this.deps.log.warn('ClickHouse unavailable; monitor states are kept until it responds');
      }
      throw error;
    }

    const current = this.deps.monitors.get(monitor.id);
    if (!current?.enabled) return current ?? measured;

    const thresholds = { warning: current.warningThreshold, critical: current.criticalThreshold };
    const state = deriveAlertState(value, thresholds, DIRECTIONS[current.type]);
    // The value covers the window it was measured over.
    const message = alertMessage({ ...current, windowMinutes: measured.windowMinutes, thresholds }, state, value);
    const event = this.deps.monitors.recordEvaluation(current, { state, value, message }, new Date());

    if (event && current.webhookUrl && (isAlerting(event.fromState) || isAlerting(event.toState))) {
      const payload = webhookPayload(publicMonitor(current), event);
      void sendWebhook(current.webhookUrl, payload).then((status) => {
        this.deps.monitors.setWebhookStatus(event.id, status);
        if (status.startsWith('failed')) this.deps.log.warn({ monitorId: current.id, status }, 'Alert webhook failed');
      });
    }
    return this.deps.monitors.get(monitor.id) ?? current;
  }

  /**
   * Evaluates without failing the caller — the interval, or a request that
   * already saved its change. Errors are logged and the stored monitor is
   * returned; ClickHouse outages are reported once by `evaluate`.
   */
  async evaluateQuietly(monitor: ScopedAlertMonitor): Promise<ScopedAlertMonitor> {
    try {
      return await this.evaluate(monitor);
    } catch (error) {
      if (!(error instanceof ClickHouseUnavailableError)) {
        this.deps.log.error({ err: error, monitorId: monitor.id }, 'Monitor evaluation failed');
      }
      return this.deps.monitors.get(monitor.id) ?? monitor;
    }
  }

  /** Value in the unit of the monitor type; null when there is nothing to measure. */
  private async measure(monitor: ScopedAlertMonitor): Promise<number | null> {
    const scope = { projectId: monitor.projectId, environment: monitor.environment };
    const fromMs = Date.now() - monitor.windowMinutes * 60_000;

    if (monitor.type === 'host_resource') {
      const [host] = await this.deps.metrics.hosts(scope, fromMs, fromMs, monitor.target);
      const ratio = host?.[monitor.metric ?? 'cpu'] ?? null;
      return ratio === null ? null : Math.round(ratio * 1000) / 10;
    }

    const stats = await this.deps.spans.windowStats(scope, monitor.target, fromMs);
    switch (monitor.type) {
      case 'service_down':
        return stats.requests;
      case 'error_rate':
        return stats.requests > 0 ? Math.round((stats.errors / stats.requests) * 1000) / 10 : null;
      case 'latency':
        return stats.requests > 0 ? stats.p95Ms : null;
    }
  }
}
