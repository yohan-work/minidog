import type { Deployment } from '@minidog/types';
import type { ChartMarker } from '@/components/observability/TimeSeriesChart';

/** Deployments this close together (one release of several services) share a marker. */
const GROUP_MS = 2 * 60 * 1000;

/**
 * Deployments as chart markers. Across services the label names the services,
 * and a release that deploys several at once becomes one line instead of
 * overlapping labels.
 */
export function deploymentMarkers(deployments: readonly Deployment[] | undefined, withService: boolean): ChartMarker[] {
  const groups: Deployment[][] = [];
  for (const deployment of [...(deployments ?? [])].sort((a, b) => a.at - b.at)) {
    const last = groups.at(-1);
    if (withService && last && deployment.at - last[0]!.at <= GROUP_MS) last.push(deployment);
    else groups.push([deployment]);
  }
  return groups.map((group) => ({ t: group[0]!.at / 1000, label: markerLabel(group, withService) }));
}

function markerLabel(group: readonly Deployment[], withService: boolean): string {
  const [first] = group as [Deployment, ...Deployment[]];
  if (!withService) return first.version;
  if (group.length === 1) return `${first.service} ${first.version}`;
  const sameVersion = group.every((deployment) => deployment.version === first.version);
  return sameVersion
    ? `${group.map((deployment) => deployment.service).join(', ')} ${first.version}`
    : `${group.length} deployments`;
}
