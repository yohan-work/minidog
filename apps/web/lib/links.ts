import type { TimeRange } from '@minidog/types';
import { withRange } from './range-href';

type Params = Record<string, string | number | null | undefined>;

function query(params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// Correlation: every telemetry screen links to the others with filters applied.

export const serviceHref = (service: string, range: TimeRange) =>
  withRange(`/services/${encodeURIComponent(service)}`, range);

export const tracesHref = (filters: { service?: string; endpoint?: string; status?: 'error' | 'ok' }, range: TimeRange) =>
  withRange(`/traces${query(filters)}`, range);

export const traceHref = (traceId: string, range: TimeRange, spanId?: string) =>
  withRange(`/traces/${traceId}${query({ span: spanId })}`, range);

export const logsHref = (filters: { service?: string; traceId?: string; level?: string }, range: TimeRange) =>
  withRange(`/logs${query(filters)}`, range);

export const metricsHref = (filters: { metric?: string; service?: string; host?: string }, range: TimeRange) =>
  withRange(`/metrics${query(filters)}`, range);
