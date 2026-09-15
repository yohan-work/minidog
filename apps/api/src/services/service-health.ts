import { SERVICE_THRESHOLDS, type HealthStatus } from '@minidog/types';

export interface ServiceHealthInput {
  /** Entry spans in the current window. */
  requests: number;
  errors: number;
  p95Ms: number | null;
}

export interface ServiceHealth {
  health: HealthStatus;
  reason: string | null;
}

const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;
const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);

/**
 * Signal over data: collapses the current window into one state.
 *
 * - unknown:  no requests in the current window
 * - critical: error rate ≥ 10% or P95 ≥ 3 s
 * - degraded: error rate ≥ 2%, P95 ≥ 1 s, or any failure among a few requests
 *
 * Error rate is checked before latency; the reason names the cause.
 */
export function deriveServiceHealth(input: ServiceHealthInput): ServiceHealth {
  const { requests, errors, p95Ms } = input;
  if (requests === 0) return { health: 'unknown', reason: 'No recent requests' };

  const { errorRate, p95Ms: latency, minRequests } = SERVICE_THRESHOLDS;
  const rate = errors / requests;
  const enoughRequests = requests >= minRequests;

  if (enoughRequests && rate >= errorRate.critical)
    return { health: 'critical', reason: `Error rate ${percent(rate)}` };
  if (p95Ms !== null && p95Ms >= latency.critical) return { health: 'critical', reason: `P95 ${duration(p95Ms)}` };
  if (enoughRequests && rate >= errorRate.degraded)
    return { health: 'degraded', reason: `Error rate ${percent(rate)}` };
  if (!enoughRequests && errors > 0) {
    return { health: 'degraded', reason: `${errors} of ${requests} request${requests === 1 ? '' : 's'} failed` };
  }
  if (p95Ms !== null && p95Ms >= latency.degraded) return { health: 'degraded', reason: `P95 ${duration(p95Ms)}` };
  return { health: 'healthy', reason: null };
}
