import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { API_KEY_HEADER } from '@minidog/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../app';
import { parseOtlpLogs } from '../ingest/otlp-logs';
import { parseOtlpMetrics } from '../ingest/otlp-metrics';
import { parseOtlpTraces } from '../ingest/otlp-traces';
import { HttpError } from '../lib/errors';
import type { Scope } from '../repositories/project-repository';

const MAX_BODY_BYTES = 16 * 1024 * 1024;

interface Signal<Row> {
  path: string;
  parse: (body: unknown, scope: Scope) => { rows: Row[]; rejected: number };
  store: (rows: Row[]) => Promise<void>;
  /** Field of the Export*ServiceResponse partial success. */
  rejectedField: 'rejectedDataPoints' | 'rejectedSpans' | 'rejectedLogRecords';
  rejectedMessage: string;
}

/**
 * Ingestion API: OTLP/HTTP with JSON encoding (`otlp_http` exporter with
 * `encoding: json`), plain or gzip. Protobuf requests are refused with 415 by
 * the content type parser. ClickHouse being down surfaces as 503, which
 * OTLP exporters retry. Requests may carry an API key (see ingestScope).
 */
export function registerIngestRoutes(app: FastifyInstance, ctx: AppContext): void {
  register(app, ctx, {
    path: '/v1/metrics',
    parse: parseOtlpMetrics,
    store: (rows) => ctx.metrics.insert(rows),
    rejectedField: 'rejectedDataPoints',
    rejectedMessage: 'Only gauge and sum data points are stored.',
  });
  register(app, ctx, {
    path: '/v1/traces',
    parse: parseOtlpTraces,
    store: (rows) => ctx.spans.insert(rows),
    rejectedField: 'rejectedSpans',
    rejectedMessage: 'Spans need a trace id, span id and start time.',
  });
  register(app, ctx, {
    path: '/v1/logs',
    parse: parseOtlpLogs,
    store: (rows) => ctx.logs.insert(rows),
    rejectedField: 'rejectedLogRecords',
    rejectedMessage: '',
  });
}

function register<Row>(app: FastifyInstance, ctx: AppContext, signal: Signal<Row>): void {
  app.post(
    signal.path,
    {
      bodyLimit: MAX_BODY_BYTES,
      preParsing: async (request, _reply, payload) => decode(request.headers['content-encoding'], payload),
    },
    async (request, reply) => {
      const { rows, rejected } = signal.parse(request.body, ingestScope(ctx, request));
      await signal.store(rows);
      return reply.send(
        rejected > 0 ? { partialSuccess: { [signal.rejectedField]: String(rejected), errorMessage: signal.rejectedMessage } } : {},
      );
    },
  );
}

/**
 * An API key selects its project and environment. Without one, data goes to
 * the default project unless INGEST_REQUIRE_API_KEY is set. An empty header
 * (e.g. an unset MINIDOG_API_KEY in the collector) counts as no key.
 */
function ingestScope(ctx: AppContext, request: FastifyRequest): Scope {
  const header = request.headers[API_KEY_HEADER];
  const bearer = request.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const secret = (Array.isArray(header) ? header[0] : header)?.trim() || bearer;

  if (secret) {
    const scope = ctx.apiKeys.resolve(secret);
    if (!scope) throw new HttpError(401, 'invalid_api_key', 'The API key is invalid or has been revoked.');
    return scope;
  }
  if (ctx.ingest.requireApiKey) {
    throw new HttpError(401, 'api_key_required', `Send an API key in the ${API_KEY_HEADER} header.`);
  }
  return ctx.defaultScope;
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
