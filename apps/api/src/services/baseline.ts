import type { ServiceBaseline } from '@minidog/types';

export interface WindowStats {
  requests: number;
  errors: number;
  p95Ms: number | null;
}

const ratioChange = (current: number | null, previous: number | null): number | null =>
  current === null || previous === null || previous === 0 ? null : current / previous - 1;

const errorRate = (stats: WindowStats): number | null => (stats.requests === 0 ? null : stats.errors / stats.requests);

/**
 * The current window against the same window a week earlier. Null when last
 * week had no requests: there is nothing to compare with, and "↑ ∞%" helps
 * nobody. Error rate changes are in percentage points, because a ratio of two
 * small rates (0.1% → 0.3% is "+200%") reads as an outage when it is three
 * requests.
 */
export function compareToBaseline(current: WindowStats, lastWeek: WindowStats): ServiceBaseline | null {
  if (lastWeek.requests === 0) return null;
  const currentRate = errorRate(current);
  const baselineRate = errorRate(lastWeek);
  return {
    requests: lastWeek.requests,
    errorRate: baselineRate,
    p95Ms: lastWeek.p95Ms,
    requestsChange: ratioChange(current.requests, lastWeek.requests),
    errorRateChange: currentRate === null || baselineRate === null ? null : currentRate - baselineRate,
    p95Change: ratioChange(current.p95Ms, lastWeek.p95Ms),
  };
}
