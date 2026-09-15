import type { SummaryResponse, SummarySettings } from '@minidog/types';
import { HttpError } from '../lib/errors';
import type { AlertMonitorRepository } from '../repositories/alert-monitor-repository';
import type { GapRepository } from '../repositories/gap-repository';
import type { MonitorRepository } from '../repositories/monitor-repository';
import type { SummaryRepository } from '../repositories/summary-repository';
import type { SyntheticResultRepository } from '../repositories/synthetic-result-repository';
import { dueSummary, summaryText, type SummaryMonitor } from './summary';
import { sendWebhook, summaryPayload } from './webhook';

const DAY_MS = 24 * 60 * 60 * 1000;
/** After a failed send (no network yet, webhook down), wait this long before trying again. */
const RETRY_MS = 10 * 60_000;

/** Builds the daily or weekly summary of every project and sends it to the configured webhook. */
export class SummaryService {
  constructor(
    private readonly store: SummaryRepository,
    private readonly monitors: MonitorRepository,
    private readonly results: SyntheticResultRepository,
    private readonly alerts: AlertMonitorRepository,
    private readonly gaps: GapRepository,
  ) {}

  async overview(): Promise<SummaryResponse> {
    const last = this.store.last();
    let preview: string;
    try {
      preview = await this.build(1);
    } catch {
      preview = 'Preview unavailable: check results could not be read.';
    }
    return { settings: this.store.settings(), lastSentAt: last.sentAt, lastStatus: last.status, lastFailedAt: last.failedAt ?? null, preview };
  }

  save(settings: SummarySettings): void {
    this.store.saveSettings(settings);
  }

  /** Sends a summary now, outside the schedule; resolves to the delivery status. */
  async send(days: 1 | 7, now: number = Date.now()): Promise<string> {
    const { webhookUrl } = this.store.settings();
    if (!webhookUrl) throw new HttpError(400, 'no_webhook', 'Save a webhook URL first.');
    return sendWebhook(webhookUrl, summaryPayload(await this.build(days, now), days));
  }

  /** Called every minute: sends the day's summary once it is due. */
  async sendIfDue(now: number = Date.now()): Promise<void> {
    const settings = this.store.settings();
    const last = this.store.last();
    if (last.failedAt && now - Date.parse(last.failedAt) < RETRY_MS) return;
    const due = dueSummary(settings, last.date, now);
    if (!due) return;
    // Built first: if check results cannot be read, the next minute tries again.
    const text = await this.build(due.days, now);
    const sentAt = new Date(now).toISOString();
    this.store.saveLast({ date: due.date, sentAt, status: 'sending' });
    const status = await sendWebhook(settings.webhookUrl, summaryPayload(text, due.days));
    // A failed day stays due, so it is retried instead of lost.
    if (status.startsWith('sent')) this.store.saveLast({ date: due.date, sentAt, status });
    else this.store.saveLast({ date: last.date, sentAt: last.sentAt, status, failedAt: sentAt });
  }

  async build(days: 1 | 7, now: number = Date.now()): Promise<string> {
    const settings = this.store.settings();
    const fromMs = now - days * DAY_MS;

    // Monitors belong to a project and environment; results are read per scope.
    const byScope = new Map<string, ReturnType<MonitorRepository['listEnabled']>>();
    for (const monitor of this.monitors.listEnabled()) {
      const key = `${monitor.projectId}|${monitor.environment}`;
      byScope.set(key, [...(byScope.get(key) ?? []), monitor]);
    }
    const monitors: SummaryMonitor[] = [];
    for (const group of byScope.values()) {
      const scope = { projectId: group[0]!.projectId, environment: group[0]!.environment };
      const summaries = await this.results.summaries(
        scope,
        group.map((monitor) => monitor.id),
        fromMs,
      );
      for (const monitor of group) {
        const summary = summaries.get(monitor.id);
        monitors.push({
          name: monitor.name,
          checks: summary?.checks ?? 0,
          failures: summary?.failures ?? 0,
          avgLatencyMs: summary?.avgLatencyMs ?? null,
          p95LatencyMs: summary?.p95LatencyMs ?? null,
          sslExpiresAt: summary?.sslExpiresAt ?? null,
        });
      }
    }
    monitors.sort((a, b) => a.name.localeCompare(b.name));

    const events = this.alerts.eventsSince(new Date(fromMs).toISOString());
    return summaryText({
      days,
      now,
      timeZone: settings.timeZone,
      monitors,
      alertChanges: events.length,
      criticalChanges: events.filter((event) => event.toState === 'critical').length,
      gaps: this.gaps.list(fromMs, now),
    });
  }
}
