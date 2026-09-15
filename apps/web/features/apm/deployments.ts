import type { Deployment } from '@minidog/types';
import type { ChartMarker } from '@/components/observability/TimeSeriesChart';

/** Deployments as chart markers; across services the label names the service. */
export function deploymentMarkers(deployments: readonly Deployment[] | undefined, withService: boolean): ChartMarker[] {
  return (deployments ?? []).map((deployment) => ({
    t: deployment.at / 1000,
    label: withService ? `${deployment.service} ${deployment.version}` : deployment.version,
  }));
}
