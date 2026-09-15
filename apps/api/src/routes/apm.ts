import { TRACE_SORTS } from '@minidog/types';
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

const errorQuerySchema = rangeQuerySchema
  .extend({
    ...windowFields,
    service: optionalText(255),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .superRefine(checkWindow);

export function registerApmRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/services', async (request) => {
    const { range } = rangeQuerySchema.parse(request.query);
    return ctx.apm.list(range);
  });

  app.get('/api/services/:service', async (request) => {
    const { service } = serviceParamsSchema.parse(request.params);
    const { range } = rangeQuerySchema.parse(request.query);
    return ctx.apm.detail(service, range);
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
}
