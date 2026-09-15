import type { Deployment, VersionSummary } from '@minidog/types';
import type { RawVersionRow } from '../repositories/span-repository';

/**
 * A deployment is a version seen for the first time in the range that
 * replaces an earlier version of the same service. A service's very first
 * version is not a deployment, and a rollback to a version seen before is not
 * detected (its first span is older).
 */
export function deriveDeployments(rows: readonly RawVersionRow[], fromMs: number): Deployment[] {
  const byService = new Map<string, RawVersionRow[]>();
  for (const row of rows) byService.set(row.service, [...(byService.get(row.service) ?? []), row]);

  const deployments: Deployment[] = [];
  for (const [service, versions] of byService) {
    const ordered = [...versions].sort((a, b) => a.firstSeenAt - b.firstSeenAt);
    ordered.forEach((row, index) => {
      const previous = ordered[index - 1];
      if (previous && row.firstSeenAt >= fromMs) {
        deployments.push({ service, version: row.version, previousVersion: previous.version, at: row.firstSeenAt });
      }
    });
  }
  return deployments.sort((a, b) => a.at - b.at);
}

/** Versions that served requests or were deployed in the range, newest first. */
export function summarizeVersions(rows: readonly RawVersionRow[], fromMs: number): VersionSummary[] {
  return rows
    .filter((row) => row.requests > 0 || row.firstSeenAt >= fromMs)
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt)
    .map((row) => ({
      version: row.version,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      requests: row.requests,
      errors: row.errors,
      errorRate: row.requests > 0 ? row.errors / row.requests : null,
      p95Ms: row.p95Ms,
    }));
}
