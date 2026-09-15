import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { context, metrics, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { AggregationTemporalityPreference, OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { envDetector, resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * OTLP/HTTP JSON exporters. The endpoint and headers come from the standard
 * OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS variables
 * (default http://localhost:4318, the bundled collector).
 */
export function startTelemetry(service: string): NodeSDK {
  const sdk = new NodeSDK({
    // OTEL_RESOURCE_ATTRIBUTES can add or override attributes, host.name included. The default
    // host detector is left out: it replaced host.name with the container id in Docker.
    resourceDetectors: [envDetector],
    resource: resourceFromAttributes({
      'service.name': service,
      // Restart with DEMO_VERSION=1.1.0 to simulate a deployment.
      'service.version': process.env.DEMO_VERSION ?? '1.0.0',
      'host.name': process.env.DEMO_HOST_NAME ?? hostname(),
      'deployment.environment.name': process.env.DEMO_ENVIRONMENT ?? 'production',
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ temporalityPreference: AggregationTemporalityPreference.DELTA }),
      exportIntervalMillis: 15_000,
    }),
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  });
  sdk.start();
  return sdk;
}

const tracer = trace.getTracer('demo-shop');
/**
 * Call after startTelemetry: unlike tracers, the metrics API has no proxy, so
 * a meter taken before the SDK starts stays a no-op.
 */
export const getMeter = () => metrics.getMeter('demo-shop');

const SEVERITY = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
} as const;

/** Emitted inside the active span, so the record carries its trace and span id. */
export function log(
  level: keyof typeof SEVERITY,
  message: string,
  attributes: Record<string, string | number> = {},
): void {
  logs.getLogger('demo-shop').emit({
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: message,
    attributes,
  });
}

export interface ServiceResponse {
  status: number;
  body: unknown;
}

/** Outgoing HTTP call as a client span, with W3C trace context in the headers. */
export function callService(peer: string, method: string, url: string, body?: unknown): Promise<ServiceResponse> {
  const target = new URL(url);
  return tracer.startActiveSpan(
    `${method} ${peer}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'http.request.method': method,
        'url.full': url,
        'server.address': target.hostname,
        'server.port': Number(target.port),
        'peer.service': peer,
      },
    },
    async (span) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      propagation.inject(context.active(), headers);
      try {
        const response = await fetch(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        span.setAttribute('http.response.status_code', response.status);
        if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        return { status: response.status, body: await response.json().catch(() => null) };
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/** Simulated PostgreSQL query: a client span that takes `durationMs`. */
export function dbQuery(statement: string, table: string, durationMs: number): Promise<void> {
  return tracer.startActiveSpan(
    'postgres.query',
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system.name': 'postgresql',
        'db.collection.name': table,
        'db.query.text': statement,
        'server.address': 'postgres',
      },
    },
    async (span) => {
      await sleep(durationMs);
      span.end();
    },
  );
}

/** An internal step of a request. */
export function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL }, async (span) => {
    try {
      return await run();
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}
