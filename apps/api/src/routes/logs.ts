import { LOG_ATTRIBUTE_FILTERS_MAX, LOG_LEVELS } from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { atField, checkWindow, emptyAsUndefined, optionalText, traceIdSchema, windowFields } from './query';
import { rangeQuerySchema } from './schemas';

/**
 * `?attr=key:value`, repeatable. The key ends at the first colon: attribute
 * keys are dotted names (`http.method`), values may hold anything.
 */
const attributeFilter = z
  .string()
  .max(1024)
  .refine((text) => text.indexOf(':') > 0, 'Give attribute filters as key:value.')
  .transform((text) => {
    const at = text.indexOf(':');
    return { key: text.slice(0, at), value: text.slice(at + 1) };
  });

/** One `?attr=` arrives as a string, several as an array; empty ones are dropped. */
export const attributeFilters = z.preprocess(
  (value) => (value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value]),
  z.array(attributeFilter).max(LOG_ATTRIBUTE_FILTERS_MAX, `At most ${LOG_ATTRIBUTE_FILTERS_MAX} attribute filters.`),
);

const logQuerySchema = rangeQuerySchema
  .extend({
    ...windowFields,
    service: optionalText(255),
    level: emptyAsUndefined(z.enum(LOG_LEVELS).optional()),
    q: optionalText(200),
    traceId: emptyAsUndefined(traceIdSchema.optional()),
    at: atField,
    attr: attributeFilters,
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
    const { level, q, traceId, attr, ...query } = logQuerySchema.parse(request.query);
    return ctx.logSearch.search({
      ...query,
      minLevel: level,
      query: q,
      traceId: traceId?.toLowerCase(),
      attributes: attr.length > 0 ? attr : undefined,
    });
  });

  app.get('/api/logs/tail', async (request) => {
    const { level, q, ...query } = tailQuerySchema.parse(request.query);
    return ctx.logSearch.tail({ ...query, minLevel: level, query: q });
  });
}
