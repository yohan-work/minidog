import type { CheckStatus, HealthStatus } from '@minidog/types';

export const SSL_EXPIRY_WARNING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface HealthInput {
  enabled: boolean;
  intervalSeconds: number;
  lastStatus: CheckStatus | null;
  /** Epoch milliseconds. */
  lastCheckedAt: number | null;
  /** Newest first. */
  recentStatuses: readonly CheckStatus[];
  /** Epoch milliseconds. */
  sslExpiresAt: number | null;
  now: number;
}

export interface HealthResult {
  health: HealthStatus;
  reason: string | null;
  stale: boolean;
}

/** A check is overdue after three missed intervals, with slack for short intervals. */
export function isStale(lastCheckedAt: number, intervalSeconds: number, now: number): boolean {
  const allowanceSeconds = Math.max(intervalSeconds * 3, intervalSeconds + 120);
  return now - lastCheckedAt > allowanceSeconds * 1000;
}

/**
 * Signal over data: collapses recent checks into one state.
 *
 * - critical: the last two checks failed (or the only check failed)
 * - degraded: the last check failed once, a recent check failed, or the
 *   certificate expires within 14 days
 * - unknown:  paused, never checked, or checks are overdue
 */
export function deriveHealth(input: HealthInput): HealthResult {
  if (!input.enabled) return { health: 'unknown', reason: 'Paused', stale: false };
  if (input.lastCheckedAt === null || input.lastStatus === null) {
    return { health: 'unknown', reason: 'Waiting for first check', stale: false };
  }
  if (isStale(input.lastCheckedAt, input.intervalSeconds, input.now)) {
    return { health: 'unknown', reason: 'No recent checks', stale: true };
  }

  const recent = input.recentStatuses.length > 0 ? input.recentStatuses : [input.lastStatus];

  if (input.lastStatus === 'down') {
    let consecutive = 0;
    for (const status of recent) {
      if (status !== 'down') break;
      consecutive += 1;
    }
    if (consecutive >= 2 || recent.length === 1) {
      return {
        health: 'critical',
        reason: consecutive >= 2 ? `Failed ${consecutive} consecutive checks` : 'Latest check failed',
        stale: false,
      };
    }
    return { health: 'degraded', reason: 'Latest check failed', stale: false };
  }

  const failures = recent.filter((status) => status === 'down').length;
  if (failures > 0) {
    return { health: 'degraded', reason: `Failed ${failures} of last ${recent.length} checks`, stale: false };
  }

  if (input.sslExpiresAt !== null) {
    const days = Math.ceil((input.sslExpiresAt - input.now) / DAY_MS);
    if (days <= SSL_EXPIRY_WARNING_DAYS) {
      return {
        health: 'degraded',
        reason: days <= 0 ? 'SSL certificate expired' : `SSL certificate expires in ${days} day${days === 1 ? '' : 's'}`,
        stale: false,
      };
    }
  }

  return { health: 'healthy', reason: null, stale: false };
}
