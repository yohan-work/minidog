import type { ClickHouseClient } from '@clickhouse/client';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { ZodError } from 'zod';
import type { ValidationIssue } from '@minidog/types';
import type { Config } from './config';
import { createClickHouse, ensureClickHouseSchema } from './db/clickhouse';
import { openDatabase } from './db/sqlite';
import { errorBody, HttpError } from './lib/errors';
import { MetricRepository } from './repositories/metric-repository';
import { MonitorRepository } from './repositories/monitor-repository';
import { ProjectRepository, type Scope } from './repositories/project-repository';
import { SyntheticResultRepository } from './repositories/synthetic-result-repository';
import { registerHostRoutes } from './routes/hosts';
import { registerIngestRoutes } from './routes/ingest';
import { registerMonitorRoutes } from './routes/monitors';
import { registerSystemRoutes } from './routes/system';
import { HostService } from './services/host-service';
import { MonitorService } from './services/monitor-service';
import { ResultWriter } from './worker/result-writer';
import { SyntheticScheduler } from './worker/synthetic-scheduler';

export interface AppContext {
  scope: Scope;
  projectName: string;
  monitors: MonitorRepository;
  results: SyntheticResultRepository;
  service: MonitorService;
  metrics: MetricRepository;
  hosts: HostService;
  /** Null when WORKER_ENABLED=false. */
  scheduler: SyntheticScheduler | null;
}

export interface BuildAppOptions {
  sqlite?: DatabaseSync;
  clickhouse?: ClickHouseClient;
}

export async function buildApp(config: Config, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  const sqlite = options.sqlite ?? openDatabase(config.SQLITE_PATH);
  const clickhouse = options.clickhouse ?? createClickHouse(config);

  const { projectName, ...scope } = new ProjectRepository(sqlite).ensureDefault();
  const monitors = new MonitorRepository(sqlite);
  const results = new SyntheticResultRepository(clickhouse);
  const metrics = new MetricRepository(clickhouse);
  const writer = new ResultWriter(results, app.log);
  const scheduler = config.WORKER_ENABLED
    ? new SyntheticScheduler({ monitors, writer, log: app.log, concurrency: config.WORKER_CONCURRENCY })
    : null;

  const ctx: AppContext = {
    scope,
    projectName,
    monitors,
    results,
    service: new MonitorService(monitors, results, scope),
    metrics,
    hosts: new HostService(metrics, scope),
    scheduler,
  };

  const lifetime = new AbortController();
  app.addHook('onReady', async () => {
    void ensureClickHouseSchema(clickhouse, app.log, lifetime.signal);
    writer.start();
    scheduler?.start();
  });
  app.addHook('onClose', async () => {
    lifetime.abort();
    scheduler?.stop();
    await writer.stop();
    await clickhouse.close();
    sqlite.close();
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ZodError) {
      const details: ValidationIssue[] = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return reply.status(400).send(errorBody('validation_error', details[0]?.message ?? 'Invalid request.', details));
    }
    if (error instanceof HttpError) {
      if (error.statusCode >= 500) request.log.warn({ err: error.cause ?? error }, error.message);
      return reply.status(error.statusCode).send(errorBody(error.code, error.message, error.details));
    }
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply
        .status(fastifyError.statusCode)
        .send(errorBody(fastifyError.code ?? 'bad_request', fastifyError.message ?? 'Bad request.'));
    }
    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send(errorBody('internal_error', 'Unexpected server error.'));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(errorBody('not_found', `Route ${request.method} ${request.url} not found.`)),
  );

  // The dashboard polls every few seconds and collectors export every 15s;
  // per-request info logs would drown out worker logs. Warnings and errors
  // from these routes are still logged.
  await app.register(
    async (routes) => {
      registerSystemRoutes(routes, ctx);
      registerMonitorRoutes(routes, ctx);
      registerHostRoutes(routes, ctx);
      registerIngestRoutes(routes, ctx);
    },
    { logLevel: 'warn' },
  );

  return app;
}
