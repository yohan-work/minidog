import { ALERT_MONITOR_TYPES, ALERT_WINDOWS_MINUTES, HOST_RESOURCE_METRICS } from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { publicMonitor } from '../repositories/alert-monitor-repository';
import { idParamsSchema } from './schemas';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const threshold = z.number().finite().min(0, 'Thresholds cannot be negative.').max(1_000_000);
const windowMinutes = z
  .number()
  .int()
  .refine((value) => (ALERT_WINDOWS_MINUTES as readonly number[]).includes(value), 'Unsupported window.');
const webhookUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => value === '' || isHttpUrl(value), 'Enter an http:// or https:// URL, or leave it empty.');

const createSchema = z
  .object({
    name: z.string().trim().max(100, 'Use at most 100 characters.').optional(),
    type: z.enum(ALERT_MONITOR_TYPES),
    target: z.string().trim().min(1, 'Choose a service or host.').max(255),
    metric: z.enum(HOST_RESOURCE_METRICS).optional(),
    warningThreshold: threshold.nullable().optional(),
    criticalThreshold: threshold.optional(),
    windowMinutes: windowMinutes.optional(),
    webhookUrl: webhookUrl.optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(100),
    warningThreshold: threshold.nullable(),
    criticalThreshold: threshold,
    windowMinutes,
    webhookUrl,
    enabled: z.boolean(),
  })
  .partial()
  .strict();

export function registerAlertingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { alerting } = ctx;

  app.get('/api/alerting/monitors', async () => alerting.list());

  app.post('/api/alerting/monitors', async (request, reply) => {
    const monitor = alerting.create(createSchema.parse(request.body ?? {}));
    return reply.status(201).send({ monitor: publicMonitor(monitor) });
  });

  app.get('/api/alerting/monitors/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return alerting.detail(id);
  });

  app.patch('/api/alerting/monitors/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return { monitor: publicMonitor(alerting.update(id, updateSchema.parse(request.body ?? {}))) };
  });

  app.delete('/api/alerting/monitors/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    alerting.delete(id);
    return reply.status(204).send();
  });

  app.post('/api/alerting/monitors/:id/evaluate', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return alerting.evaluate(id);
  });

  app.get('/api/alerting/summary', async () => alerting.summary());

  app.post('/api/alerting/events/acknowledge', async (_request, reply) => {
    alerting.acknowledgeAll();
    return reply.status(204).send();
  });
}
