import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { rangeQuerySchema } from './schemas';

const hostParamsSchema = z.object({ host: z.string().min(1).max(255) });

export function registerHostRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/hosts', async (request) => {
    const { range } = rangeQuerySchema.parse(request.query);
    return ctx.hosts.list(range);
  });

  app.get('/api/hosts/:host', async (request) => {
    const { host } = hostParamsSchema.parse(request.params);
    const { range } = rangeQuerySchema.parse(request.query);
    return ctx.hosts.detail(host, range);
  });
}
