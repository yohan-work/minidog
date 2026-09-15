import type { MeasurementGap, SummarySettings } from '@minidog/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const count = new Intl.NumberFormat('en-US');

export interface LocalTime {
  /** `YYYY-MM-DD` */
  date: string;
  hour: number;
  /** `Mon`, `Tue`, … */
  weekday: string;
}

/** Date, hour and weekday of `at` in `timeZone`. */
export function localTime(at: number, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')), weekday: part('weekday') };
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The summary to send now, if any: once per local day, at or after the chosen
 * hour, so a day missed while the computer was off goes out when minidog runs.
 */
export function dueSummary(settings: SummarySettings, lastSentDate: string | null, now: number): { date: string; days: 1 | 7 } | null {
  if (!settings.enabled || !settings.webhookUrl) return null;
  const local = localTime(now, settings.timeZone);
  if (local.hour < settings.hour || local.date === lastSentDate) return null;
  return { date: local.date, days: settings.weekly && local.weekday === 'Mon' ? 7 : 1 };
}

export interface SummaryMonitor {
  name: string;
  checks: number;
  failures: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  /** Epoch ms. */
  sslExpiresAt: number | null;
}

export interface SummaryInput {
  days: 1 | 7;
  now: number;
  timeZone: string;
  monitors: SummaryMonitor[];
  /** Alert state changes in the period, and how many of them went critical. */
  alertChanges: number;
  criticalChanges: number;
  gaps: MeasurementGap[];
}

/** Plain text that reads well in a phone notification or a chat message. */
export function summaryText(input: SummaryInput): string {
  const title = input.days === 7 ? 'minidog weekly summary' : 'minidog daily summary';
  const date = new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(input.now);
  const lines = [`${title} · ${date} (last ${input.days === 7 ? '7 days' : '24 h'})`];

  if (input.monitors.length === 0) lines.push('No synthetic monitors are running.');
  else for (const monitor of input.monitors) lines.push(`• ${monitorLine(monitor, input.now)}`);

  lines.push(
    input.alertChanges === 0
      ? 'Alerts: no state changes'
      : `Alerts: ${input.alertChanges} state ${input.alertChanges === 1 ? 'change' : 'changes'}` +
          (input.criticalChanges > 0 ? ` (${input.criticalChanges} into critical)` : ''),
  );

  const byReason = new Map<string, number>();
  for (const gap of input.gaps) byReason.set(gap.reason, (byReason.get(gap.reason) ?? 0) + (gap.to - gap.from));
  const unmeasured = [...byReason.values()].reduce((sum, ms) => sum + ms, 0);
  if (unmeasured > 0) {
    const reasons = [...byReason].map(([reason, ms]) => (byReason.size > 1 ? `${reason} ${formatDuration(ms)}` : reason));
    lines.push(`Not measured: ${formatDuration(unmeasured)} (${reasons.join(', ')})`);
  }
  return lines.join('\n');
}

function monitorLine(monitor: SummaryMonitor, now: number): string {
  if (monitor.checks === 0) return `${monitor.name} — no checks`;
  const up = (monitor.checks - monitor.failures) / monitor.checks;
  const detail =
    monitor.failures > 0
      ? `${count.format(monitor.failures)} of ${count.format(monitor.checks)} failed`
      : `${count.format(monitor.checks)} ${monitor.checks === 1 ? 'check' : 'checks'}`;
  const parts = [`${monitor.name} — ${formatUp(up)} up (${detail})`];
  if (monitor.avgLatencyMs !== null) parts.push(`avg ${formatMs(monitor.avgLatencyMs)}`);
  if (monitor.p95LatencyMs !== null) parts.push(`p95 ${formatMs(monitor.p95LatencyMs)}`);
  if (monitor.sslExpiresAt !== null) parts.push(sslText(monitor.sslExpiresAt - now));
  return parts.join(' · ');
}

function sslText(msLeft: number): string {
  if (msLeft <= 0) return 'SSL EXPIRED';
  const days = Math.floor(msLeft / DAY_MS);
  return days === 0 ? 'SSL expires today' : `SSL ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Rounded down, so 99.96% never reads as 100%. */
function formatUp(ratio: number): string {
  return ratio >= 1 ? '100%' : `${(Math.floor(ratio * 1000) / 10).toFixed(1)}%`;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
