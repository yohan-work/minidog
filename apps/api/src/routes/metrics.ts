import { METRIC_AGGREGATIONS } from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { emptyAsUndefined, optionalText } from './query';
import { rangeQuerySchema } from './schemas';

const metricQuerySchema = rangeQuerySchema.extend({
  metric: z.string().trim().min(1, 'Choose a metric.').max(255),
  aggregation: emptyAsUndefined(z.enum(METRIC_AGGREGATIONS).default('avg')),
  service: optionalText(255),
  host: optionalText(255),
  groupBy: emptyAsUndefined(
    z
      .string()
      .regex(/^(service|host|attr:[\w.\-/]{1,200})$/, 'Group by service, host or attr:<key>.')
      .optional(),
  ),
});

export function registerMetricRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/metrics/catalog', async (request) => {
    const { range } = rangeQuerySchema.parse(request.query);
    return ctx.metricsExplorer.catalog(range);
  });

  app.get('/api/metrics/query', async (request) => {
    return ctx.metricsExplorer.query(metricQuerySchema.parse(request.query));
  });
}
