import {
  ALERT_DELAYS_MINUTES,
  ALERT_METRICS,
  ALERT_MONITOR_TYPES,
  ALERT_MUTE_MINUTES,
  ALERT_WINDOWS_MINUTES,
} from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { publicMonitor } from '../repositories/alert-monitor-repository';
import { sendWebhook, testWebhookPayload, webhookFormat } from '../services/webhook';
import { idParamsSchema } from './schemas';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const oneOf = (allowed: readonly number[], message: string) =>
  z
    .number()
    .int()
    .refine((value) => allowed.includes(value), message);

const threshold = z.number().finite().min(0, 'Thresholds cannot be negative.').max(1_000_000);
const windowMinutes = oneOf(ALERT_WINDOWS_MINUTES, 'Unsupported window.');
const delayMinutes = oneOf(ALERT_DELAYS_MINUTES, 'Unsupported delay.');
const webhookUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => value === '' || isHttpUrl(value), 'Enter an http:// or https:// URL, or leave it empty.');

const createSchema = z
  .object({
    name: z.string().trim().max(100, 'Use at most 100 characters.').optional(),
    type: z.enum(ALERT_MONITOR_TYPES),
    target: z.string().trim().min(1, 'Choose a target.').max(255),
    metric: z.enum(ALERT_METRICS).optional(),
    warningThreshold: threshold.nullable().optional(),
    criticalThreshold: threshold.optional(),
    windowMinutes: windowMinutes.optional(),
    webhookUrl: webhookUrl.optional(),
    alertAfterMinutes: delayMinutes.optional(),
    recoverAfterMinutes: delayMinutes.optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(100),
    warningThreshold: threshold.nullable(),
    criticalThreshold: threshold,
    windowMinutes,
    webhookUrl,
    alertAfterMinutes: delayMinutes,
    recoverAfterMinutes: delayMinutes,
    enabled: z.boolean(),
  })
  .partial()
  .strict();

const webhookTestSchema = z
  .object({ url: webhookUrl.refine((value) => value !== '', 'Enter a webhook URL.') })
  .strict();

const muteSchema = z.object({ minutes: oneOf(ALERT_MUTE_MINUTES, 'Unsupported mute duration.') }).strict();

export function registerAlertingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { alerting } = ctx;

  app.get('/api/alerting/monitors', async () => alerting.list());

  app.post('/api/alerting/monitors', async (request, reply) => {
    const monitor = await alerting.create(createSchema.parse(request.body ?? {}));
    return reply.status(201).send({ monitor: publicMonitor(monitor) });
  });

  app.get('/api/alerting/monitors/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return alerting.detail(id);
  });

  app.patch('/api/alerting/monitors/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return { monitor: publicMonitor(await alerting.update(id, updateSchema.parse(request.body ?? {}))) };
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

  app.post('/api/alerting/monitors/:id/mute', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { minutes } = muteSchema.parse(request.body ?? {});
    return { monitor: publicMonitor(alerting.mute(id, minutes)) };
  });

  app.delete('/api/alerting/monitors/:id/mute', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return { monitor: publicMonitor(await alerting.unmute(id)) };
  });

  app.get('/api/alerting/summary', async () => alerting.summary());

  // Sends a sample notification so a URL can be checked before any alert fires.
  app.post('/api/alerting/webhook-test', async (request) => {
    const { url } = webhookTestSchema.parse(request.body ?? {});
    return { format: webhookFormat(url), status: await sendWebhook(url, testWebhookPayload()) };
  });

  app.post('/api/alerting/events/acknowledge', async (_request, reply) => {
    alerting.acknowledgeAll();
    return reply.status(204).send();
  });
}
