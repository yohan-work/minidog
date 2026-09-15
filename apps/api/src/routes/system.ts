import type { ContextResponse, HealthResponse } from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';

export function contextResponse(ctx: AppContext): ContextResponse {
  return {
    project: { id: ctx.scope.projectId, name: ctx.projects.get(ctx.scope.projectId)?.name ?? ctx.scope.projectId },
    environment: ctx.scope.environment,
    worker: { enabled: ctx.scheduler !== null },
    ingest: ctx.ingest,
    auth: { enabled: !ctx.auth.disabled },
  };
}

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async (_request, reply): Promise<HealthResponse> => {
    const clickhouse = (await ctx.results.ping()) ? 'ok' : 'unavailable';
    const body: HealthResponse = { status: clickhouse === 'ok' ? 'ok' : 'degraded', sqlite: 'ok', clickhouse };
    return reply.status(clickhouse === 'ok' ? 200 : 503).send(body);
  });

  app.get('/api/context', async (): Promise<ContextResponse> => contextResponse(ctx));
}
