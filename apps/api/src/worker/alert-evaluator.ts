import type { FastifyBaseLogger } from 'fastify';
import { alertDirection, isSyntheticAlertMetric, type AlertEvent } from '@minidog/types';
import { ClickHouseUnavailableError } from '../lib/errors';
import type { AlertMonitorRepository, ScopedAlertMonitor } from '../repositories/alert-monitor-repository';
import { MUTED_WEBHOOK_STATUS, publicMonitor } from '../repositories/alert-monitor-repository';
import type { MetricRepository } from '../repositories/metric-repository';
import type { MonitorRepository } from '../repositories/monitor-repository';
import type { SpanRepository } from '../repositories/span-repository';
import type { SyntheticResultRepository } from '../repositories/synthetic-result-repository';
import { alertMessage, deriveAlertState, isAlerting, isMuted } from '../services/alert-state';
import { sendWebhook, webhookPayload } from '../services/webhook';
import { SLEEP_THRESHOLD_MS, type GapTracker } from './gap-tracker';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AlertEvaluatorDeps {
  monitors: AlertMonitorRepository;
  spans: SpanRepository;
  metrics: MetricRepository;
  /** Synthetic checks and their results, measured by synthetic_check monitors. */
  syntheticMonitors: MonitorRepository;
  syntheticResults: SyntheticResultRepository;
  log: FastifyBaseLogger;
  intervalMs: number;
  /** Right after the machine wakes, checks have not resumed yet; passes wait. */
  gaps?: Pick<GapTracker, 'noteSleep' | 'settling'>;
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
  private readonly deliveries = new Set<Promise<void>>();
  private lastPassAt = 0;

  constructor(private readonly deps: AlertEvaluatorDeps) {}

  /** Evaluations further apart than this (missed passes, an outage) restart pending delays. */
  private get maxGapMs(): number {
    return Math.max(this.deps.intervalMs * 3, 2 * 60_000);
  }

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
    await this.settled();
  }

  /** Resolves once webhooks already started have been delivered (or failed). */
  async settled(): Promise<void> {
    await Promise.all(this.deliveries);
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
    const now = Date.now();
    // A pass far behind schedule slept with the machine; the gap tracker may not have noticed yet.
    if (this.lastPassAt > 0 && now - this.lastPassAt > this.deps.intervalMs + SLEEP_THRESHOLD_MS) {
      this.deps.gaps?.noteSleep(this.lastPassAt, now);
    }
    this.lastPassAt = now;
    if (this.deps.gaps?.settling(now)) return;
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
    const state = deriveAlertState(value, thresholds, alertDirection(current.type, current.metric));
    // The value covers the window it was measured over.
    const message = alertMessage({ ...current, windowMinutes: measured.windowMinutes, thresholds }, state, value);
    const now = new Date();
    const event = this.deps.monitors.recordEvaluation(current, { state, value, message }, now, this.maxGapMs);
    this.notify(current, event, now.getTime());
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

  /**
   * Sends changes into or out of Warning/Critical. While muted they are
   * recorded as held; once the mute is over, a held notification whose state
   * is still current is sent once.
   */
  private notify(monitor: ScopedAlertMonitor, event: AlertEvent | null, now: number): void {
    if (!monitor.webhookUrl) return;
    const muted = isMuted(monitor.mutedUntil, now);

    if (event) {
      if (!isAlerting(event.fromState) && !isAlerting(event.toState)) return;
      if (muted) this.deps.monitors.setWebhookStatus(event.id, MUTED_WEBHOOK_STATUS);
      else this.deliver(monitor, event);
      return;
    }
    if (muted) return;

    const stored = this.deps.monitors.get(monitor.id);
    const last = this.deps.monitors.lastEvent(monitor.id);
    if (
      stored &&
      last &&
      last.webhookStatus === MUTED_WEBHOOK_STATUS &&
      last.toState === stored.state &&
      isAlerting(stored.state) &&
      this.deps.monitors.claimMutedEvent(last.id)
    ) {
      this.deliver(stored, last, `still ${stored.state} after the mute ended`);
    }
  }

  private deliver(monitor: ScopedAlertMonitor, event: AlertEvent, note?: string): void {
    const delivery = sendWebhook(monitor.webhookUrl, webhookPayload(publicMonitor(monitor), event, note)).then((status) => {
      this.deps.monitors.setWebhookStatus(event.id, status);
      if (status.startsWith('failed')) this.deps.log.warn({ monitorId: monitor.id, status }, 'Alert webhook failed');
    });
    this.deliveries.add(delivery);
    void delivery.finally(() => this.deliveries.delete(delivery));
  }

  /** Value in the unit of the monitor type; null when there is nothing to measure. */
  private async measure(monitor: ScopedAlertMonitor): Promise<number | null> {
    if (monitor.type === 'synthetic_check') return this.measureSynthetic(monitor);

    const scope = { projectId: monitor.projectId, environment: monitor.environment };
    const fromMs = Date.now() - monitor.windowMinutes * 60_000;

    if (monitor.type === 'host_resource') {
      const metric = monitor.metric === 'memory' || monitor.metric === 'disk' ? monitor.metric : 'cpu';
      const [host] = await this.deps.metrics.hosts(scope, fromMs, fromMs, monitor.target);
      const ratio = host?.[metric] ?? null;
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

  /** Failed checks (%), P95 of passing checks (ms) or days until the certificate expires. */
  private async measureSynthetic(monitor: ScopedAlertMonitor): Promise<number | null> {
    const check = this.deps.syntheticMonitors.get(monitor.target);
    if (!check || check.projectId !== monitor.projectId) return null;

    const metric = isSyntheticAlertMetric(monitor.metric) ? monitor.metric : 'failure_rate';
    const now = Date.now();
    // Certificates rarely change: the latest one seen in the last day decides.
    const fromMs = now - (metric === 'ssl_days' ? DAY_MS : monitor.windowMinutes * 60_000);
    const scope = { projectId: check.projectId, environment: check.environment };
    const summary = (await this.deps.syntheticResults.summaries(scope, [check.id], fromMs)).get(check.id);
    if (!summary) return null;

    switch (metric) {
      case 'failure_rate':
        return summary.checks > 0 ? Math.round((summary.failures / summary.checks) * 1000) / 10 : null;
      case 'response_time':
        return summary.p95LatencyMs;
      case 'ssl_days':
        if (summary.sslExpiresAt === null || summary.lastCheckedAt < fromMs) return null;
        return Math.round(((summary.sslExpiresAt - now) / DAY_MS) * 10) / 10;
    }
  }
}
