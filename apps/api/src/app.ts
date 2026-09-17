import type { ClickHouseClient } from '@clickhouse/client';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { ZodError } from 'zod';
import type { ContextResponse, ValidationIssue } from '@minidog/types';
import type { Config } from './config';
import { createClickHouse, ensureClickHouseSchema } from './db/clickhouse';
import { openDatabase } from './db/sqlite';
import { errorBody, HttpError } from './lib/errors';
import { networkPolicy } from './lib/network-guard';
import { AlertMonitorRepository } from './repositories/alert-monitor-repository';
import { AuthRepository } from './repositories/auth-repository';
import { ApiKeyRepository } from './repositories/api-key-repository';
import { DashboardRepository } from './repositories/dashboard-repository';
import { GapRepository } from './repositories/gap-repository';
import { LogRepository } from './repositories/log-repository';
import { MetricRepository } from './repositories/metric-repository';
import { MonitorRepository } from './repositories/monitor-repository';
import { ProjectRepository, type Scope } from './repositories/project-repository';
import { SpanRepository } from './repositories/span-repository';
import { StorageRepository } from './repositories/storage-repository';
import { SummaryRepository } from './repositories/summary-repository';
import { SyntheticResultRepository } from './repositories/synthetic-result-repository';
import { registerAlertingRoutes } from './routes/alerting';
import { authGuard, registerAuthRoutes } from './routes/auth';
import { registerApmRoutes } from './routes/apm';
import { registerDashboardRoutes } from './routes/dashboards';
import { registerHeartbeatRoutes } from './routes/heartbeat';
import { registerHostRoutes } from './routes/hosts';
import { registerIngestRoutes } from './routes/ingest';
import { registerLogRoutes } from './routes/logs';
import { registerMetricRoutes } from './routes/metrics';
import { registerMonitorRoutes } from './routes/monitors';
import { registerSettingsRoutes } from './routes/settings';
import { registerStorageRoutes } from './routes/storage';
import { registerSummaryRoutes } from './routes/summary';
import { registerSystemRoutes } from './routes/system';
import { AlertingService } from './services/alerting-service';
import type { SmtpConfig } from './services/email';
import { AuthService } from './services/auth';
import { ApmService } from './services/apm-service';
import { HostService } from './services/host-service';
import { LogService } from './services/log-service';
import { MetricsExplorerService } from './services/metrics-explorer-service';
import { MonitorService } from './services/monitor-service';
import { StorageService } from './services/storage-service';
import { SummaryService } from './services/summary-service';
import { AlertEvaluator } from './worker/alert-evaluator';
import { GapTracker } from './worker/gap-tracker';
import { HeartbeatPinger } from './worker/heartbeat-pinger';
import { ResultWriter } from './worker/result-writer';
import { SummaryScheduler } from './worker/summary-scheduler';
import { SyntheticScheduler } from './worker/synthetic-scheduler';

export interface AppContext {
  /** Project and environment the dashboard shows; switched in place. */
  scope: Scope;
  /** Where telemetry without an API key goes. */
  defaultScope: Scope;
  projects: ProjectRepository;
  apiKeys: ApiKeyRepository;
  ingest: ContextResponse['ingest'];
  monitors: MonitorRepository;
  results: SyntheticResultRepository;
  service: MonitorService;
  metrics: MetricRepository;
  spans: SpanRepository;
  logs: LogRepository;
  hosts: HostService;
  apm: ApmService;
  logSearch: LogService;
  metricsExplorer: MetricsExplorerService;
  alerting: AlertingService;
  dashboards: DashboardRepository;
  auth: AuthService;
  storage: StorageService;
  summary: SummaryService;
  /** Null when WORKER_ENABLED=false. */
  scheduler: SyntheticScheduler | null;
  /** Null when SMTP_HOST / SMTP_FROM are unset. */
  smtp: SmtpConfig | null;
}

export interface BuildAppOptions {
  sqlite?: DatabaseSync;
  clickhouse?: ClickHouseClient;
}

export async function buildApp(config: Config, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  networkPolicy.blockPrivate = config.BLOCK_PRIVATE_TARGETS;

  const sqlite = options.sqlite ?? openDatabase(config.SQLITE_PATH);
  const clickhouse = options.clickhouse ?? createClickHouse(config);

  const projects = new ProjectRepository(sqlite);
  const defaults = projects.ensureDefault();
  const defaultScope: Scope = { projectId: defaults.projectId, environment: defaults.environment };
  // Shared by every service: switching projects updates this object in place.
  const scope: Scope = { ...(projects.activeScope() ?? defaultScope) };
  const monitors = new MonitorRepository(sqlite);
  const results = new SyntheticResultRepository(clickhouse);
  const metrics = new MetricRepository(clickhouse);
  const spans = new SpanRepository(clickhouse);
  const logs = new LogRepository(clickhouse);
  const writer = new ResultWriter(results, app.log);
  const gaps = new GapRepository(sqlite);
  // Gaps matter where checks run, so the tracker runs with the scheduler.
  const gapTracker = config.WORKER_ENABLED ? new GapTracker(gaps, app.log) : null;
  const alertMonitors = new AlertMonitorRepository(sqlite);
  const summary = new SummaryService(new SummaryRepository(sqlite), monitors, results, alertMonitors, gaps);
  // Summaries go out where checks run, alongside the scheduler.
  const summaryScheduler = config.WORKER_ENABLED
    ? new SummaryScheduler(summary, app.log, gapTracker ?? undefined)
    : null;
  const smtp: SmtpConfig | null =
    config.SMTP_HOST && config.SMTP_FROM
      ? {
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          user: config.SMTP_USER,
          password: config.SMTP_PASSWORD,
          from: config.SMTP_FROM,
        }
      : null;
  const evaluator = new AlertEvaluator({
    monitors: alertMonitors,
    spans,
    metrics,
    syntheticMonitors: monitors,
    syntheticResults: results,
    log: app.log,
    intervalMs: config.ALERT_INTERVAL_SECONDS * 1000,
    gaps: gapTracker ?? undefined,
    smtp,
  });
  const scheduler = config.WORKER_ENABLED
    ? new SyntheticScheduler({
        monitors,
        writer,
        log: app.log,
        concurrency: config.WORKER_CONCURRENCY,
        gaps: gapTracker ?? undefined,
      })
    : null;

  // Runs wherever the API runs: its silence is the signal, so it must not depend
  // on the worker being enabled.
  const heartbeat = config.HEARTBEAT_URL
    ? new HeartbeatPinger(config.HEARTBEAT_URL, config.HEARTBEAT_INTERVAL_SECONDS * 1000, app.log)
    : null;

  const ctx: AppContext = {
    scope,
    defaultScope,
    projects,
    apiKeys: new ApiKeyRepository(sqlite),
    ingest: {
      apiUrl: config.PUBLIC_API_URL,
      collectorUrl: config.PUBLIC_COLLECTOR_URL,
      requireApiKey: config.INGEST_REQUIRE_API_KEY,
    },
    monitors,
    results,
    service: new MonitorService(monitors, results, scope, gaps),
    metrics,
    spans,
    logs,
    hosts: new HostService(metrics, scope),
    apm: new ApmService(spans, logs, scope),
    logSearch: new LogService(logs, scope),
    metricsExplorer: new MetricsExplorerService(metrics, scope),
    alerting: new AlertingService(alertMonitors, evaluator, scope, config.ALERTS_ENABLED, monitors),
    dashboards: new DashboardRepository(sqlite),
    auth: new AuthService(new AuthRepository(sqlite), config.AUTH_DISABLED),
    storage: new StorageService(new StorageRepository(clickhouse), config.SQLITE_PATH),
    summary,
    scheduler,
    smtp,
  };

  const lifetime = new AbortController();
  app.addHook('onReady', async () => {
    void ensureClickHouseSchema(clickhouse, app.log, lifetime.signal);
    writer.start();
    gapTracker?.start();
    scheduler?.start();
    summaryScheduler?.start();
    heartbeat?.start();
    if (config.ALERTS_ENABLED) evaluator.start();
  });
  app.addHook('onClose', async () => {
    lifetime.abort();
    scheduler?.stop();
    gapTracker?.stop();
    summaryScheduler?.stop();
    heartbeat?.stop();
    await evaluator.stop();
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
      routes.addHook('onRequest', authGuard(ctx));
      registerAuthRoutes(routes, ctx);
      registerSystemRoutes(routes, ctx);
      registerDashboardRoutes(routes, ctx);
      registerStorageRoutes(routes, ctx);
      registerSummaryRoutes(routes, ctx);
      registerMonitorRoutes(routes, ctx);
      registerHostRoutes(routes, ctx);
      registerApmRoutes(routes, ctx);
      registerLogRoutes(routes, ctx);
      registerMetricRoutes(routes, ctx);
      registerAlertingRoutes(routes, ctx);
      registerHeartbeatRoutes(routes, ctx);
      registerSettingsRoutes(routes, ctx);
      registerIngestRoutes(routes, ctx);
    },
    { logLevel: 'warn' },
  );

  return app;
}
