import {
  METRIC_MAX_GROUPS,
  type MetricAggregation,
  type MetricCatalogResponse,
  type MetricQueryResponse,
  type TimeRange,
} from '@minidog/types';
import { timeWindow } from '../lib/time-window';
import type { MetricRepository } from '../repositories/metric-repository';
import type { Scope } from '../repositories/project-repository';

export interface MetricQuery {
  range: TimeRange;
  metric: string;
  aggregation: MetricAggregation;
  service?: string;
  host?: string;
  groupBy?: string;
}

export class MetricsExplorerService {
  constructor(
    private readonly metrics: MetricRepository,
    private readonly scope: Scope,
  ) {}

  async catalog(range: TimeRange): Promise<MetricCatalogResponse> {
    return { range, metrics: await this.metrics.catalog(this.scope, timeWindow(range).fromMs) };
  }

  async query({ range, ...query }: MetricQuery): Promise<MetricQueryResponse> {
    const window = timeWindow(range);
    const [rows, catalog] = await Promise.all([
      this.metrics.aggregate(this.scope, { ...query, fromMs: window.fromMs, stepSeconds: window.stepSeconds }),
      this.metrics.catalog(this.scope, window.fromMs),
    ]);

    const timestamps: number[] = [];
    for (let t = window.startSeconds; t <= window.endSeconds; t += window.stepSeconds) timestamps.push(t);
    const index = new Map(timestamps.map((t, position) => [t, position]));

    const groups = new Map<string, (number | null)[]>();
    for (const row of rows) {
      const position = index.get(row.t);
      if (position === undefined) continue;
      const values = groups.get(row.group) ?? timestamps.map(() => null);
      values[position] = row.value;
      groups.set(row.group, values);
    }

    // Largest groups first, by total magnitude over the range.
    const ranked = [...groups]
      .map(([key, values]) => ({
        key,
        values,
        weight: values.reduce<number>((sum, value) => sum + Math.abs(value ?? 0), 0),
      }))
      .sort((a, b) => b.weight - a.weight);

    return {
      range,
      metric: query.metric,
      unit: catalog.find((entry) => entry.name === query.metric)?.unit ?? '',
      aggregation: query.aggregation,
      stepSeconds: window.stepSeconds,
      timestamps,
      groups: ranked.slice(0, METRIC_MAX_GROUPS).map(({ key, values }) => ({ key, values })),
      omittedGroups: Math.max(ranked.length - METRIC_MAX_GROUPS, 0),
    };
  }
}
