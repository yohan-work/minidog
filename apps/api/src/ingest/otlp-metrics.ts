import { HttpError } from '../lib/errors';
import type { Scope } from '../repositories/project-repository';
import { toDateTime64 } from '../repositories/synthetic-result-repository';

/** Row shape of `metrics` as written with JSONEachRow. */
export interface MetricRow {
  timestamp: string;
  project_id: string;
  environment: string;
  service: string;
  host: string;
  metric_name: string;
  metric_type: 'gauge' | 'sum';
  temporality: '' | 'delta' | 'cumulative';
  unit: string;
  value: number;
  attributes: Record<string, string>;
  resource_attributes: Record<string, string>;
}

// OTLP/JSON (protobuf JSON mapping). Only the fields minidog reads are typed;
// 64-bit integers arrive as strings.
interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  bytesValue?: string;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
}

interface KeyValue {
  key?: string;
  value?: AnyValue;
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
  if (!isObject(body) || (body.resourceMetrics !== undefined && !Array.isArray(body.resourceMetrics))) {
    throw new HttpError(400, 'invalid_otlp', 'Expected an OTLP ExportMetricsServiceRequest in JSON encoding.');
  }

  const rows: MetricRow[] = [];
  let rejected = 0;

  for (const resourceMetrics of (body as ExportMetricsRequest).resourceMetrics ?? []) {
    const resource = toAttributes(resourceMetrics.resource?.attributes);
    const base = {
      project_id: scope.projectId,
      environment: resource['deployment.environment.name'] || resource['deployment.environment'] || scope.environment,
      service: resource['service.name'] ?? '',
      host: resource['host.name'] ?? '',
      resource_attributes: resource,
    };

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
          rows.push({
            ...base,
            timestamp: toDateTime64(new Date(pointTime(point, now))),
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** Epoch milliseconds; points without a usable timestamp take the receive time. */
function pointTime(point: NumberDataPoint, now: number): number {
  if (point.timeUnixNano === undefined) return now;
  try {
    const ms = Number(BigInt(String(point.timeUnixNano)) / 1_000_000n);
    return ms > 0 ? ms : now;
  } catch {
    return now;
  }
}

function toAttributes(list: readonly KeyValue[] | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const item of list ?? []) {
    if (item.key) attributes[item.key] = anyValueToString(item.value);
  }
  return attributes;
}

function anyValueToString(value: AnyValue | undefined): string {
  if (!value) return '';
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return String(value.boolValue);
  if (value.intValue !== undefined) return String(value.intValue);
  if (value.doubleValue !== undefined) return String(value.doubleValue);
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue) return JSON.stringify((value.arrayValue.values ?? []).map(anyValueToString));
  if (value.kvlistValue) return JSON.stringify(toAttributes(value.kvlistValue.values));
  return '';
}
