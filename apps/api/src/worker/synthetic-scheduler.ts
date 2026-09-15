import type { FastifyBaseLogger } from 'fastify';
import { MONITOR_DEFAULTS, type SyntheticMonitor } from '@minidog/types';
import type { MonitorRepository } from '../repositories/monitor-repository';
import { toDateTime, toDateTime64, type SyntheticResultRow } from '../repositories/synthetic-result-repository';
import { parseExpectedStatus } from '../services/expected-status';
import { performHttpCheck, type HttpCheckResult } from '../services/http-check';
import type { GapTracker } from './gap-tracker';
import { SLEEP_THRESHOLD_MS } from './gap-tracker';
import type { ResultWriter } from './result-writer';

export interface SchedulerDeps {
  monitors: MonitorRepository;
  writer: ResultWriter;
  log: FastifyBaseLogger;
  concurrency: number;
  /** Notices sleep and holds checks right after waking, while the network comes back. */
  gaps?: Pick<GapTracker, 'noteSleep' | 'settling' | 'settledAt'>;
}

/** Spreads the first run of each monitor so a restart does not fire every check at once. */
const MAX_STARTUP_JITTER_MS = 10_000;

/**
 * Runs HTTP checks for enabled monitors on their interval. Each monitor has a
 * single timer; checks are executed through a bounded queue.
 */
export class SyntheticScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** When each timer was meant to fire; a timer far behind it slept with the machine. */
  private readonly dueAt = new Map<string, number>();
  /** Queued or running monitor ids — a monitor never runs twice concurrently. */
  private readonly pending = new Set<string>();
  private readonly queue: string[] = [];
  private active = 0;
  private started = false;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    const monitors = this.deps.monitors.listEnabled();
    for (const monitor of monitors) {
      const jitter = Math.random() * Math.min(monitor.intervalSeconds * 1000, MAX_STARTUP_JITTER_MS);
      this.schedule(monitor.id, jitter);
    }
    this.deps.log.info({ monitors: monitors.length }, 'Synthetic scheduler started');
  }

  stop(): void {
    this.started = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.queue.length = 0;
  }

  /** Re-reads a monitor after create/update; enabled monitors are checked right away. */
  sync(id: string): void {
    this.cancel(id);
    const monitor = this.deps.monitors.get(id);
    if (monitor?.enabled) this.schedule(id, 0);
  }

  cancel(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.dueAt.delete(id);
  }

  /**
   * Runs a check immediately, outside the queue, and waits until the result is
   * written. The regular schedule restarts from now.
   */
  async runNow(monitor: SyntheticMonitor): Promise<{ result: HttpCheckResult; persisted: boolean }> {
    this.cancel(monitor.id);
    try {
      const result = await this.check(monitor);
      const persisted = await this.deps.writer.flushAll();
      return { result, persisted };
    } finally {
      if (monitor.enabled) this.schedule(monitor.id, monitor.intervalSeconds * 1000);
    }
  }

  private schedule(id: string, delayMs: number): void {
    if (!this.started) return;
    clearTimeout(this.timers.get(id));
    this.dueAt.set(id, Date.now() + delayMs);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.fire(id);
      }, delayMs),
    );
  }

  private fire(id: string): void {
    const now = Date.now();
    const due = this.dueAt.get(id) ?? now;
    const gaps = this.deps.gaps;
    if (gaps && now - due > SLEEP_THRESHOLD_MS) gaps.noteSleep(due, now);
    // Right after waking, a check would mostly measure the network reconnecting.
    if (gaps?.settling(now)) {
      this.schedule(id, gaps.settledAt() - now + Math.random() * MAX_STARTUP_JITTER_MS);
      return;
    }
    this.enqueue(id);
  }

  private enqueue(id: string): void {
    if (this.pending.has(id)) return;
    this.pending.add(id);
    this.queue.push(id);
    this.drain();
  }

  private drain(): void {
    while (this.started && this.active < this.deps.concurrency && this.queue.length > 0) {
      void this.execute(this.queue.shift()!);
    }
  }

  private async execute(id: string): Promise<void> {
    const monitor = this.deps.monitors.get(id);
    if (!monitor?.enabled) {
      this.pending.delete(id);
      return;
    }

    this.active += 1;
    const startedAt = Date.now();
    try {
      await this.check(monitor);
    } catch (error) {
      this.deps.log.error({ err: error, monitorId: id }, 'Synthetic check crashed');
    } finally {
      this.active -= 1;
      this.pending.delete(id);
      this.schedule(id, Math.max(0, monitor.intervalSeconds * 1000 - (Date.now() - startedAt)));
      this.drain();
    }
  }

  private async check(monitor: SyntheticMonitor): Promise<HttpCheckResult> {
    const startedMs = Date.now();
    const expectedStatus =
      parseExpectedStatus(monitor.expectedStatus) ?? parseExpectedStatus(MONITOR_DEFAULTS.expectedStatus)!;
    const result = await performHttpCheck({
      url: monitor.url,
      method: monitor.method,
      timeoutMs: monitor.timeoutMs,
      expectedStatus,
      followRedirects: monitor.followRedirects,
      bodyContains: monitor.bodyContains,
    });
    // Far past its timeout, the check was suspended with the machine: its result says nothing about the site.
    const endedMs = Date.now();
    if (endedMs - startedMs > monitor.timeoutMs + SLEEP_THRESHOLD_MS) {
      this.deps.log.info({ monitorId: monitor.id }, 'Discarded a check interrupted by sleep');
      this.deps.gaps?.noteSleep(startedMs, endedMs);
      return result;
    }
    this.deps.writer.push(toRow(monitor, result));
    return result;
  }
}

function toRow(monitor: SyntheticMonitor, result: HttpCheckResult): SyntheticResultRow {
  return {
    timestamp: toDateTime64(result.startedAt),
    project_id: monitor.projectId,
    environment: monitor.environment,
    monitor_id: monitor.id,
    url: monitor.url,
    status: result.status,
    status_code: result.statusCode,
    latency_ms: result.latencyMs,
    dns_ms: result.dnsMs,
    connect_ms: result.connectMs,
    tls_ms: result.tlsMs,
    ttfb_ms: result.ttfbMs,
    ssl_expiry: result.sslExpiresAt ? toDateTime(result.sslExpiresAt) : null,
    error: result.error,
    redirects: result.redirects,
    final_url: result.finalUrl,
  };
}
