import { HOST_CURRENT_WINDOW_SECONDS, HOST_THRESHOLDS, type HealthStatus } from '@minidog/types';

export interface HostHealthInput {
  /** Epoch milliseconds. */
  lastSeenAt: number;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  diskMountpoint: string | null;
  now: number;
}

export interface HostHealth {
  health: HealthStatus;
  reason: string | null;
}

/**
 * Signal over data: collapses current utilization into one state.
 *
 * - unknown:  no data within the current window, or no utilization metrics
 * - critical: CPU, memory or disk at 95% or more
 * - degraded: CPU, memory or disk at 85% or more
 *
 * The fullest resource is named as the reason.
 */
export function deriveHostHealth(input: HostHealthInput): HostHealth {
  if (input.now - input.lastSeenAt > HOST_CURRENT_WINDOW_SECONDS * 1000) {
    return { health: 'unknown', reason: 'Not reporting' };
  }

  const readings = [
    { label: 'Disk', value: input.disk, suffix: input.diskMountpoint ? ` on ${input.diskMountpoint}` : '' },
    { label: 'Memory', value: input.memory, suffix: '' },
    { label: 'CPU', value: input.cpu, suffix: '' },
  ].filter((reading): reading is { label: string; value: number; suffix: string } => reading.value !== null);

  if (readings.length === 0) return { health: 'unknown', reason: 'No utilization metrics' };

  const fullest = readings.reduce((worst, reading) => (reading.value > worst.value ? reading : worst));
  if (fullest.value < HOST_THRESHOLDS.degraded) return { health: 'healthy', reason: null };

  return {
    health: fullest.value >= HOST_THRESHOLDS.critical ? 'critical' : 'degraded',
    reason: `${fullest.label} ${Math.round(fullest.value * 100)}%${fullest.suffix}`,
  };
}
