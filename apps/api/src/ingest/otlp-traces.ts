import type { SpanKind, SpanStatus } from '@minidog/types';
import type { Scope } from '../repositories/project-repository';
import {
  assertExportRequest,
  nanosToDateTime64,
  normalizeId,
  parseNanos,
  resourceContext,
  toAttributes,
  type KeyValue,
  type ResourceContext,
} from './otlp-common';

/** Row shape of `spans` as written with JSONEachRow. */
export interface SpanRow extends ResourceContext {
  /** Span start. */
  timestamp: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  name: string;
  kind: SpanKind;
  duration_ms: number;
  status_code: SpanStatus;
  status_message: string;
  http_method: string;
  http_route: string;
  http_status: number;
  db_system: string;
  /** `POST /checkout` for entry spans, '' otherwise. */
  endpoint: string;
  /** Server, consumer or root span: one request handled by the service. */
  is_entry: 0 | 1;
  is_error: 0 | 1;
  attributes: Record<string, string>;
  /** JSON array of `{ timeUnixMs, name, attributes }`. */
  events: string;
}

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number | string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: KeyValue[];
  events?: { timeUnixNano?: string | number; name?: string; attributes?: KeyValue[] }[];
  status?: { code?: number | string; message?: string };
}

interface ExportTraceRequest {
  resourceSpans?: {
    resource?: { attributes?: KeyValue[] };
    scopeSpans?: { spans?: OtlpSpan[] }[];
  }[];
}

export interface ParsedSpans {
  rows: SpanRow[];
  /** Spans without a trace id, span id or start time. */
  rejected: number;
}

const KINDS: Record<string, SpanKind> = {
  '0': 'unspecified',
  '1': 'internal',
  '2': 'server',
  '3': 'client',
  '4': 'producer',
  '5': 'consumer',
  SPAN_KIND_UNSPECIFIED: 'unspecified',
  SPAN_KIND_INTERNAL: 'internal',
  SPAN_KIND_SERVER: 'server',
  SPAN_KIND_CLIENT: 'client',
  SPAN_KIND_PRODUCER: 'producer',
  SPAN_KIND_CONSUMER: 'consumer',
};

const STATUSES: Record<string, SpanStatus> = {
  '0': 'unset',
  '1': 'ok',
  '2': 'error',
  STATUS_CODE_UNSET: 'unset',
  STATUS_CODE_OK: 'ok',
  STATUS_CODE_ERROR: 'error',
};

/**
 * Normalizes an OTLP ExportTraceServiceRequest (JSON encoding). HTTP and
 * database attributes are lifted into columns, accepting both current and
 * legacy semantic convention names.
 */
export function parseOtlpTraces(body: unknown, scope: Scope): ParsedSpans {
  assertExportRequest(body, 'resourceSpans', 'ExportTraceServiceRequest');

  const rows: SpanRow[] = [];
  let rejected = 0;

  for (const resourceSpans of (body as ExportTraceRequest).resourceSpans ?? []) {
    const context = resourceContext(resourceSpans.resource?.attributes, scope);

    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const span of scopeSpans.spans ?? []) {
        const traceId = normalizeId(span.traceId, 16);
        const spanId = normalizeId(span.spanId, 8);
        const start = parseNanos(span.startTimeUnixNano);
        if (!traceId || !spanId || start === null) {
          rejected += 1;
          continue;
        }
        const end = parseNanos(span.endTimeUnixNano) ?? start;
        const parentSpanId = normalizeId(span.parentSpanId, 8);
        const attributes = toAttributes(span.attributes);
        const kind = KINDS[String(span.kind ?? 0)] ?? 'unspecified';
        const status = STATUSES[String(span.status?.code ?? 0)] ?? 'unset';
        const name = span.name ?? '';
        const httpMethod = attributes['http.request.method'] ?? attributes['http.method'] ?? '';
        const httpRoute = attributes['http.route'] ?? '';
        const httpStatus =
          Number.parseInt(attributes['http.response.status_code'] ?? attributes['http.status_code'] ?? '', 10) || 0;
        const isEntry = kind === 'server' || kind === 'consumer' || parentSpanId === '';

        rows.push({
          ...context,
          timestamp: nanosToDateTime64(start),
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: parentSpanId,
          name,
          kind,
          duration_ms: Number(end > start ? end - start : 0n) / 1e6,
          status_code: status,
          status_message: span.status?.message ?? '',
          http_method: httpMethod,
          http_route: httpRoute,
          http_status: httpStatus,
          db_system: attributes['db.system.name'] ?? attributes['db.system'] ?? '',
          endpoint: isEntry ? (httpMethod && httpRoute ? `${httpMethod} ${httpRoute}` : name) : '',
          is_entry: isEntry ? 1 : 0,
          is_error: status === 'error' || (kind === 'server' && httpStatus >= 500) ? 1 : 0,
          attributes,
          events: serializeEvents(span.events),
        });
      }
    }
  }

  return { rows, rejected };
}

function serializeEvents(events: OtlpSpan['events']): string {
  if (!events || events.length === 0) return '[]';
  return JSON.stringify(
    events.map((event) => {
      const nanos = parseNanos(event.timeUnixNano);
      return {
        timeUnixMs: nanos === null ? null : Number(nanos / 1_000n) / 1_000,
        name: event.name ?? '',
        attributes: toAttributes(event.attributes),
      };
    }),
  );
}
