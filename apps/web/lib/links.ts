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

export const tracesHref = (
  filters: { service?: string; endpoint?: string; status?: 'error' | 'ok' },
  range: TimeRange,
) => withRange(`/traces${query(filters)}`, range);

/**
 * `at`: when the trace was seen (epoch ms). A trace id says nothing about
 * time, so with it the API looks in the days around that moment instead of
 * across the whole retention. Pass it wherever the row has a timestamp.
 */
export const traceHref = (traceId: string, range: TimeRange, spanId?: string, at?: number) =>
  withRange(`/traces/${traceId}${query({ span: spanId, at: at === undefined ? undefined : Math.round(at) })}`, range);

export const logsHref = (
  filters: { service?: string; traceId?: string; level?: string; at?: number },
  range: TimeRange,
) =>
  withRange(`/logs${query({ ...filters, at: filters.at === undefined ? undefined : Math.round(filters.at) })}`, range);

export const metricsHref = (filters: { metric?: string; service?: string; host?: string }, range: TimeRange) =>
  withRange(`/metrics${query(filters)}`, range);

export const endpointHref = (service: string, endpoint: string, range: TimeRange) =>
  withRange(`/services/${encodeURIComponent(service)}/endpoint${query({ e: endpoint })}`, range);
