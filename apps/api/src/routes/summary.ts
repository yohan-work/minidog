import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { isValidTimeZone } from '../services/summary';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    webhookUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => value === '' || isHttpUrl(value), 'Enter an http:// or https:// URL, or leave it empty.'),
    hour: z.number().int().min(0).max(23),
    weekly: z.boolean(),
    timeZone: z.string().min(1).max(64).refine(isValidTimeZone, 'Unknown time zone.'),
  })
  .strict()
  .refine((value) => !value.enabled || value.webhookUrl !== '', {
    message: 'Enter a webhook URL to send summaries to.',
    path: ['webhookUrl'],
  });

const sendSchema = z
  .object({
    days: z.union([z.literal(1), z.literal(7)]).default(1),
    /** The URL in the form, which may not be saved yet. */
    webhookUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => value === '' || isHttpUrl(value), 'Enter an http:// or https:// URL.')
      .optional(),
  })
  .strict();

export function registerSummaryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/summary', async () => ctx.summary.overview());

  app.put('/api/summary', async (request) => {
    ctx.summary.save(settingsSchema.parse(request.body ?? {}));
    return ctx.summary.overview();
  });

  app.post('/api/summary/send', async (request) => {
    const { days, webhookUrl } = sendSchema.parse(request.body ?? {});
    return { status: await ctx.summary.send(days, webhookUrl) };
  });
}
