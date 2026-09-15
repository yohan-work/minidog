import { LOG_LEVELS } from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { checkWindow, emptyAsUndefined, optionalText, traceIdSchema, windowFields } from './query';
import { rangeQuerySchema } from './schemas';

const logQuerySchema = rangeQuerySchema
  .extend({
    ...windowFields,
    service: optionalText(255),
    level: emptyAsUndefined(z.enum(LOG_LEVELS).optional()),
    q: optionalText(200),
    traceId: emptyAsUndefined(traceIdSchema.optional()),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
  })
  .superRefine(checkWindow);

const tailQuerySchema = z.object({
  since: z.coerce.number({ error: 'Give since as epoch milliseconds.' }).int().positive(),
  service: optionalText(255),
  level: emptyAsUndefined(z.enum(LOG_LEVELS).optional()),
  q: optionalText(200),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

export function registerLogRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/logs', async (request) => {
    const { level, q, traceId, ...query } = logQuerySchema.parse(request.query);
    return ctx.logSearch.search({ ...query, minLevel: level, query: q, traceId: traceId?.toLowerCase() });
  });

  app.get('/api/logs/tail', async (request) => {
    const { level, q, ...query } = tailQuerySchema.parse(request.query);
    return ctx.logSearch.tail({ ...query, minLevel: level, query: q });
  });
}
