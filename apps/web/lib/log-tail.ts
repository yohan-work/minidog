import type { LogEntry } from '@minidog/types';

/** How often live tail polls while the tab is visible. */
export const TAIL_INTERVAL_MS = 2_000;
/** Records shown when live tail starts. */
export const TAIL_START_LOOKBACK_MS = 60_000;
/**
 * Each poll re-reads this much before the previous one, so records exported
 * late by an SDK's batch processor still appear.
 */
export const TAIL_OVERLAP_MS = 30_000;
/** Records kept on screen; older ones fall off the bottom. */
export const TAIL_BUFFER = 1_000;

/**
 * Merges a poll into the buffer (both newest first). The poll is complete from
 * `since` onward (or from its oldest record when it hit its limit), so it
 * replaces the buffer there; buffered records older than that are kept.
 */
export function mergeTail(buffer: readonly LogEntry[], fresh: readonly LogEntry[], since: number, truncated: boolean): LogEntry[] {
  const cutoff = truncated && fresh.length > 0 ? fresh[fresh.length - 1]!.timestamp : since;
  const older = buffer.filter((log) => log.timestamp < cutoff);
  return [...fresh, ...older].slice(0, TAIL_BUFFER);
}

/** Where the next poll starts, from the server clock of the last one. */
export function nextSince(serverNow: number): number {
  return serverNow - TAIL_OVERLAP_MS;
}
