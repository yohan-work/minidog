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
  /**
   * Liveness, not readiness: 200 means this process is serving, and an
   * unreachable ClickHouse is reported in the body instead. The API is built to
   * keep working without it — sign-in, synthetic checks, alert state and every
   * SQLite screen — and container healthchecks read this route, so failing it
   * would stop the dashboard and the collector from starting at all.
   */
  app.get('/api/health', async (): Promise<HealthResponse> => {
    const clickhouse = (await ctx.results.ping()) ? 'ok' : 'unavailable';
    return { status: clickhouse === 'ok' ? 'ok' : 'degraded', sqlite: 'ok', clickhouse };
  });

  app.get('/api/context', async (): Promise<ContextResponse> => contextResponse(ctx));
}
