import {
  HOST_CURRENT_WINDOW_SECONDS,
  type HostListResponse,
  type HostResponse,
  type HostSeriesPoint,
  type HostSummary,
  type TimeRange,
} from '@minidog/types';
import { NotFoundError } from '../lib/errors';
import { timeWindow, type TimeWindow } from '../lib/time-window';
import type {
  MetricRepository,
  NetworkRate,
  RawHost,
  RawNetworkPoint,
  RawUtilizationPoint,
} from '../repositories/metric-repository';
import type { Scope } from '../repositories/project-repository';
import { deriveHostHealth } from './host-health';

/** A host page still opens for a host that stopped reporting within this span. */
const DETAIL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Hosts are identified by the `host.name` of the telemetry they send; there is no host registry. */
export class HostService {
  constructor(
    private readonly metrics: MetricRepository,
    private readonly scope: Scope,
  ) {}

  async list(range: TimeRange): Promise<HostListResponse> {
    const now = Date.now();
    const currentFromMs = now - HOST_CURRENT_WINDOW_SECONDS * 1000;
    const [hosts, rates] = await Promise.all([
      this.metrics.hosts(this.scope, timeWindow(range, now).fromMs, currentFromMs),
      this.metrics.networkRates(this.scope, currentFromMs),
    ]);
    return { range, hosts: hosts.map((raw) => toSummary(raw, rates.get(raw.host), now)) };
  }

  async detail(host: string, range: TimeRange): Promise<HostResponse> {
    const now = Date.now();
    const window = timeWindow(range, now);
    const currentFromMs = now - HOST_CURRENT_WINDOW_SECONDS * 1000;
    const [[raw], rates, utilization, network] = await Promise.all([
      this.metrics.hosts(this.scope, now - DETAIL_LOOKBACK_MS, currentFromMs, host),
      this.metrics.networkRates(this.scope, currentFromMs, host),
      this.metrics.utilizationSeries(this.scope, host, window.fromMs, window.stepSeconds),
      this.metrics.networkSeries(this.scope, host, window.fromMs, window.stepSeconds),
    ]);
    if (!raw) throw new NotFoundError('Host');

    return {
      range,
      host: toSummary(raw, rates.get(host), now),
      series: { range, stepSeconds: window.stepSeconds, points: fillHostSeries(window, utilization, network) },
    };
  }
}

function toSummary(raw: RawHost, rate: NetworkRate | undefined, now: number): HostSummary {
  const { health, reason } = deriveHostHealth({ ...raw, now });
  return {
    host: raw.host,
    os: raw.os,
    health,
    healthReason: reason,
    lastSeenAt: raw.lastSeenAt,
    cpu: raw.cpu,
    memory: raw.memory,
    disk: raw.disk,
    diskMountpoint: raw.diskMountpoint,
    networkRxBps: rate?.rxBps ?? null,
    networkTxBps: rate?.txBps ?? null,
  };
}

/** One point per bucket; buckets without data carry nulls so charts show gaps. */
function fillHostSeries(
  window: TimeWindow,
  utilization: readonly RawUtilizationPoint[],
  network: readonly RawNetworkPoint[],
): HostSeriesPoint[] {
  const utilizationByBucket = new Map(utilization.map((point) => [point.t, point]));
  const networkByBucket = new Map(network.map((point) => [point.t, point]));
  const points: HostSeriesPoint[] = [];
  for (let t = window.startSeconds; t <= window.endSeconds; t += window.stepSeconds) {
    const resources = utilizationByBucket.get(t);
    const traffic = networkByBucket.get(t);
    points.push({
      t,
      cpu: resources?.cpu ?? null,
      memory: resources?.memory ?? null,
      disk: resources?.disk ?? null,
      networkRxBps: traffic?.rxBps ?? null,
      networkTxBps: traffic?.txBps ?? null,
    });
  }
  return points;
}
