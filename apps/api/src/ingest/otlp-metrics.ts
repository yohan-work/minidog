import type { Scope } from '../repositories/project-repository';
import { toDateTime64 } from '../repositories/synthetic-result-repository';
import { assertExportRequest, parseNanos, resourceContext, toAttributes, type KeyValue, type ResourceContext } from './otlp-common';

/** Row shape of `metrics` as written with JSONEachRow. */
export interface MetricRow extends ResourceContext {
  timestamp: string;
  metric_name: string;
  metric_type: 'gauge' | 'sum';
  temporality: '' | 'delta' | 'cumulative';
  unit: string;
  value: number;
  attributes: Record<string, string>;
}

interface NumberDataPoint {
  attributes?: KeyValue[];
  timeUnixNano?: string | number;
  asDouble?: number | string;
  asInt?: string | number;
}

interface OtlpMetric {
  name?: string;
  unit?: string;
  gauge?: { dataPoints?: NumberDataPoint[] };
  sum?: { dataPoints?: NumberDataPoint[]; aggregationTemporality?: number | string };
  histogram?: { dataPoints?: unknown[] };
  exponentialHistogram?: { dataPoints?: unknown[] };
  summary?: { dataPoints?: unknown[] };
}

interface ExportMetricsRequest {
  resourceMetrics?: {
    resource?: { attributes?: KeyValue[] };
    scopeMetrics?: { metrics?: OtlpMetric[] }[];
  }[];
}

export interface ParsedMetrics {
  rows: MetricRow[];
  /** Data points minidog does not store: histograms, summaries, or points without a finite value. */
  rejected: number;
}

const TEMPORALITY: Record<string, MetricRow['temporality']> = {
  '1': 'delta',
  AGGREGATION_TEMPORALITY_DELTA: 'delta',
  '2': 'cumulative',
  AGGREGATION_TEMPORALITY_CUMULATIVE: 'cumulative',
};

/**
 * Normalizes an OTLP ExportMetricsServiceRequest (JSON encoding) into metric
 * rows. Gauges and sums are stored; other metric types are counted as rejected.
 */
export function parseOtlpMetrics(body: unknown, scope: Scope, now: number = Date.now()): ParsedMetrics {
  assertExportRequest(body, 'resourceMetrics', 'ExportMetricsServiceRequest');

  const rows: MetricRow[] = [];
  let rejected = 0;

  for (const resourceMetrics of (body as ExportMetricsRequest).resourceMetrics ?? []) {
    const context = resourceContext(resourceMetrics.resource?.attributes, scope);

    for (const scopeMetrics of resourceMetrics.scopeMetrics ?? []) {
      for (const metric of scopeMetrics.metrics ?? []) {
        const data = metric.gauge ?? metric.sum;
        if (!data || !metric.name) {
          rejected += countPoints(metric);
          continue;
        }
        const metricType = metric.gauge ? 'gauge' : 'sum';
        const temporality = metric.sum ? (TEMPORALITY[String(metric.sum.aggregationTemporality)] ?? '') : '';

        for (const point of data.dataPoints ?? []) {
          const value = pointValue(point);
          if (value === null) {
            rejected += 1;
            continue;
          }
          const nanos = parseNanos(point.timeUnixNano);
          rows.push({
            ...context,
            timestamp: toDateTime64(new Date(nanos === null ? now : Number(nanos / 1_000_000n))),
            metric_name: metric.name,
            metric_type: metricType,
            temporality,
            unit: metric.unit ?? '',
            value,
            attributes: toAttributes(point.attributes),
          });
        }
      }
    }
  }

  return { rows, rejected };
}

function countPoints(metric: OtlpMetric): number {
  const data = metric.gauge ?? metric.sum ?? metric.histogram ?? metric.exponentialHistogram ?? metric.summary;
  return data?.dataPoints?.length ?? 0;
}

function pointValue(point: NumberDataPoint): number | null {
  const raw = point.asDouble ?? point.asInt;
  if (raw === undefined || raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
