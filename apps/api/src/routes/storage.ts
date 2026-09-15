import { RETENTION_DAYS, RETENTION_SIGNALS } from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';

const retentionSchema = z
  .object({
    signal: z.enum(RETENTION_SIGNALS),
    days: z
      .number()
      .int()
      .refine((value) => (RETENTION_DAYS as readonly number[]).includes(value), 'Unsupported retention.'),
  })
  .strict();

export function registerStorageRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/storage', async () => ctx.storage.overview());

  app.put('/api/storage/retention', async (request) => {
    const { signal, days } = retentionSchema.parse(request.body ?? {});
    return ctx.storage.setRetention(signal, days);
  });
}
