import type { CheckResult, RunCheckResponse } from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../lib/errors';
import type { AppContext } from '../app';
import {
  checksQuerySchema,
  createMonitorSchema,
  idParamsSchema,
  rangeQuerySchema,
  timeoutIssue,
  bodyCheckAllowed,
  bodyCheckIssue,
  timeoutWithinInterval,
  updateMonitorSchema,
} from './schemas';

export function registerMonitorRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { service, monitors, scheduler, scope } = ctx;

  app.get('/api/monitors', async (request) => {
    const { range } = rangeQuerySchema.parse(request.query);
    return service.list(range);
  });

  app.post('/api/monitors', async (request, reply) => {
    const input = createMonitorSchema.parse(request.body ?? {});
    const monitor = monitors.create(scope, input);
    scheduler?.sync(monitor.id);
    return reply.status(201).send({ monitor });
  });

  app.get('/api/monitors/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { range } = rangeQuerySchema.parse(request.query);
    return service.detail(id, range);
  });

  app.patch('/api/monitors/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const patch = updateMonitorSchema.parse(request.body ?? {});
    const current = service.get(id);
    const merged = { ...current, ...patch };
    if (!timeoutWithinInterval(merged)) {
      throw new z.ZodError([{ code: 'custom', input: patch, ...timeoutIssue() }]);
    }
    if (!bodyCheckAllowed(merged)) {
      throw new z.ZodError([{ code: 'custom', input: patch, ...bodyCheckIssue() }]);
    }
    const monitor = monitors.update(id, patch)!;
    scheduler?.sync(id);
    return { monitor };
  });

  app.delete('/api/monitors/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    service.get(id);
    monitors.delete(id);
    scheduler?.cancel(id);
    return reply.status(204).send();
  });

  app.post('/api/monitors/:id/run', async (request): Promise<RunCheckResponse> => {
    const { id } = idParamsSchema.parse(request.params);
    const monitor = service.get(id);
    if (!scheduler) throw new HttpError(409, 'worker_disabled', 'The synthetic worker is disabled (WORKER_ENABLED=false).');
    const { result, persisted } = await scheduler.runNow(monitor);
    const check: CheckResult = {
      timestamp: result.startedAt.getTime(),
      status: result.status,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      dnsMs: result.dnsMs,
      connectMs: result.connectMs,
      tlsMs: result.tlsMs,
      ttfbMs: result.ttfbMs,
      sslExpiresAt: result.sslExpiresAt?.getTime() ?? null,
      error: result.error,
      redirects: result.redirects,
      finalUrl: result.finalUrl,
    };
    return { check, persisted };
  });

  app.get('/api/monitors/:id/series', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { range } = rangeQuerySchema.parse(request.query);
    return service.series(id, range);
  });

  app.get('/api/monitors/:id/checks', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { limit } = checksQuerySchema.parse(request.query);
    return service.checks(id, limit);
  });

  app.get('/api/overview', async (request) => {
    const { range } = rangeQuerySchema.parse(request.query);
    return service.overview(range);
  });
}
