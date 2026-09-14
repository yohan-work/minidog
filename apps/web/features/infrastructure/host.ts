import { HOST_THRESHOLDS, type TimeRange } from '@minidog/types';
import { withRange } from '@/lib/range-href';

/** Same thresholds the API uses for host health. */
export function utilizationTone(value: number | null | undefined): 'warning' | 'error' | undefined {
  if (value == null) return undefined;
  if (value >= HOST_THRESHOLDS.critical) return 'error';
  return value >= HOST_THRESHOLDS.degraded ? 'warning' : undefined;
}

export function hostHref(host: string, range: TimeRange): string {
  return withRange(`/infrastructure/${encodeURIComponent(host)}`, range);
}
