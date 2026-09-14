import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import { parseOtlpMetrics } from '../ingest/otlp-metrics';
import { HttpError } from '../lib/errors';

const MAX_BODY_BYTES = 16 * 1024 * 1024;

/**
 * Ingestion API: OTLP/HTTP with JSON encoding (`otlp_http` exporter with
 * `encoding: json`). Protobuf requests are refused with 415 by the content
 * type parser. Unauthenticated: the API listens on 127.0.0.1 until project
 * API keys exist.
 */
export function registerIngestRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/v1/metrics',
    {
      bodyLimit: MAX_BODY_BYTES,
      preParsing: async (request, _reply, payload) => decode(request.headers['content-encoding'], payload),
    },
    async (request, reply) => {
      const { rows, rejected } = parseOtlpMetrics(request.body, ctx.scope);
      // ClickHouse being down surfaces as 503, which the collector retries.
      await ctx.metrics.insert(rows);
      // ExportMetricsServiceResponse
      return reply.send(
        rejected > 0
          ? { partialSuccess: { rejectedDataPoints: String(rejected), errorMessage: 'Only gauge and sum data points are stored.' } }
          : {},
      );
    },
  );
}

function decode(encoding: string | undefined, payload: Readable): Readable {
  if (!encoding || encoding === 'identity') return payload;
  if (encoding !== 'gzip') {
    throw new HttpError(415, 'unsupported_encoding', `Content-Encoding "${encoding}" is not supported. Use gzip or none.`);
  }
  // Fastify compares Content-Length with the bytes received on the wire.
  const gunzip = Object.assign(createGunzip(), { receivedEncodedLength: 0 });
  payload.on('data', (chunk: Buffer) => {
    gunzip.receivedEncodedLength += chunk.length;
  });
  return payload.pipe(gunzip);
}
