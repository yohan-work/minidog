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

/** `30s`, `1m`, `5m`, `1h` */
export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

export { EMPTY };
