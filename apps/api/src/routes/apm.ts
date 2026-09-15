import { DB_QUERY_SORTS, TRACE_SORTS } from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { checkWindow, emptyAsUndefined, optionalText, traceIdSchema, windowFields } from './query';
import { rangeQuerySchema } from './schemas';

const serviceParamsSchema = z.object({ service: z.string().min(1).max(255) });
const traceParamsSchema = z.object({ traceId: traceIdSchema });

const traceQuerySchema = rangeQuerySchema
  .extend({
    ...windowFields,
    service: optionalText(255),
    endpoint: optionalText(500),
    status: emptyAsUndefined(z.enum(['error', 'ok']).optional()),
    minDurationMs: emptyAsUndefined(z.coerce.number().min(0).optional()),
    sort: emptyAsUndefined(z.enum(TRACE_SORTS).optional()),
    q: optionalText(200),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .superRefine(checkWindow);

/** `?deployments=1` adds the range's deployments (a 14-day version scan); dropdowns leave it off. */
const serviceListQuerySchema = rangeQuerySchema.extend({
  deployments: emptyAsUndefined(z.enum(['1', 'true']).optional()),
});

const queryListSchema = rangeQuerySchema
  .extend({
    ...windowFields,
    service: optionalText(255),
    sort: emptyAsUndefined(z.enum(DB_QUERY_SORTS).default('total')),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .superRefine(checkWindow);

const endpointQuerySchema = rangeQuerySchema.extend({
  endpoint: z.string({ error: 'Choose an endpoint.' }).trim().min(1, 'Choose an endpoint.').max(500),
});

const errorQuerySchema = rangeQuerySchema
  .extend({
    ...windowFields,
    service: optionalText(255),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .superRefine(checkWindow);

export function registerApmRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/services', async (request) => {
    const { range, deployments } = serviceListQuerySchema.parse(request.query);
    return ctx.apm.list(range, { deployments: deployments !== undefined });
  });

  app.get('/api/services/:service', async (request) => {
    const { service } = serviceParamsSchema.parse(request.params);
    const { range } = rangeQuerySchema.parse(request.query);
    return ctx.apm.detail(service, range);
  });

  app.get('/api/services/:service/endpoint', async (request) => {
    const { service } = serviceParamsSchema.parse(request.params);
    const { range, endpoint } = endpointQuerySchema.parse(request.query);
    return ctx.apm.endpoint(service, endpoint, range);
  });

  app.get('/api/endpoints', async (request) => {
    const { range } = rangeQuerySchema.parse(request.query);
    return ctx.apm.endpoints(range);
  });

  app.get('/api/service-map', async (request) => {
    const { range } = rangeQuerySchema.parse(request.query);
    return ctx.apm.map(range);
  });

  app.get('/api/traces', async (request) => {
    const { q, ...query } = traceQuerySchema.parse(request.query);
    return ctx.apm.traces({ ...query, query: q });
  });

  app.get('/api/traces/:traceId', async (request) => {
    const { traceId } = traceParamsSchema.parse(request.params);
    return ctx.apm.trace(traceId.toLowerCase());
  });

  app.get('/api/errors', async (request) => ctx.apm.errors(errorQuerySchema.parse(request.query)));

  app.get('/api/queries', async (request) => ctx.apm.queries(queryListSchema.parse(request.query)));
}
