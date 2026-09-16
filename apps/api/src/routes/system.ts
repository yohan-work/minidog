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

/**
 * A ClickHouse that accepts the connection but is too busy to answer — a server
 * still catching up after a reboot — would otherwise hold this route for the
 * client's timeout, which is longer than the container healthcheck allows. An
 * answer this slow is unavailable as far as the dashboard is concerned.
 */
const PING_TIMEOUT_MS = 1_500;

function reachable(ctx: AppContext): Promise<boolean> {
  const tooSlow = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
    timer.unref();
  });
  return Promise.race([ctx.results.ping(), tooSlow]);
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
    const clickhouse = (await reachable(ctx)) ? 'ok' : 'unavailable';
    return { status: clickhouse === 'ok' ? 'ok' : 'degraded', sqlite: 'ok', clickhouse };
  });

  app.get('/api/context', async (): Promise<ContextResponse> => contextResponse(ctx));
}
