const EMPTY = '—';
const integer = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const shortTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const date = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

const isNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** `248 ms`, `1.42 s`, `12.4 s` */
export function formatLatency(ms: number | null | undefined): string {
  if (!isNumber(ms)) return EMPTY;
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Axis labels: `0`, `250 ms`, `1.5 s` */
export function formatLatencyAxis(ms: number): string {
  if (ms === 0) return '0';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${Number((ms / 1000).toFixed(1))} s`;
}

/**
 * `99.98%` — truncates rather than rounds so an imperfect availability never
 * reads as `100%`.
 */
export function formatPercent(ratio: number | null | undefined, digits = 2): string {
  if (!isNumber(ratio)) return EMPTY;
  if (ratio >= 1) return '100%';
  const factor = 10 ** digits;
  return `${(Math.floor(ratio * 100 * factor) / factor).toFixed(digits)}%`;
}

/** `942`, `18.4k` */
export function formatCount(value: number | null | undefined): string {
  if (!isNumber(value)) return EMPTY;
  return value < 10_000 ? integer.format(value) : compact.format(value).toLowerCase();
}

export function formatTime(ms: number | null | undefined): string {
  return isNumber(ms) ? time.format(ms) : EMPTY;
}

export function formatShortTime(ms: number): string {
  return shortTime.format(ms);
}

export function formatDateTime(ms: number | null | undefined): string {
  return isNumber(ms) ? dateTime.format(ms) : EMPTY;
}

export function formatDate(ms: number | null | undefined): string {
  return isNumber(ms) ? date.format(ms) : EMPTY;
}

/** `12s ago`, `4m ago`, `3h ago`, `2d ago` */
export function formatRelative(ms: number | null | undefined, now: number = Date.now()): string {
  if (!isNumber(ms)) return EMPTY;
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** `82 days`, `1 day`, `Expired` */
export function formatDaysUntil(ms: number | null | undefined, now: number = Date.now()): string {
  if (!isNumber(ms)) return EMPTY;
  const days = Math.floor((ms - now) / 86_400_000);
  if (ms <= now) return 'Expired';
  return days === 1 ? '1 day' : `${days} days`;
}

export function daysUntil(ms: number, now: number = Date.now()): number {
  return Math.floor((ms - now) / 86_400_000);
}

/** Utilization 0..1 as `42.3%`. */
export function formatUtilization(ratio: number | null | undefined): string {
  if (!isNumber(ratio)) return EMPTY;
  return `${(Math.min(Math.max(ratio, 0), 1) * 100).toFixed(1)}%`;
}

/** Axis labels: `0%`, `50%`, `100%` */
export function formatUtilizationAxis(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** `812 B/s`, `4.2 KB/s`, `18 MB/s` (1 KB = 1024 B) */
export function formatBytesRate(bytesPerSecond: number | null | undefined): string {
  if (!isNumber(bytesPerSecond)) return EMPTY;
  let value = Math.max(bytesPerSecond, 0);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}/s`;
}

/** Axis labels: `0`, `512 B/s`, `1.5 MB/s` */
export function formatBytesRateAxis(bytesPerSecond: number): string {
  return bytesPerSecond === 0 ? '0' : formatBytesRate(bytesPerSecond);
}

/** `30s`, `1m`, `5m`, `1h` */
export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

export { EMPTY };
