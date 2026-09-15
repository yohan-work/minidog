import { RETENTION_MAX_DAYS } from '@minidog/types';
import { z } from 'zod';

/** Empty query parameters (`?service=`) mean "no filter". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

/** Treats `?param=` like an absent parameter before validating. */
export const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

export const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/i, 'Trace ids are 32 hex characters.');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 7 * DAY_MS;
/** Windows may start as far back as data can be kept. */
const MAX_WINDOW_AGE_MS = RETENTION_MAX_DAYS * DAY_MS;

/** `?from=&to=` (epoch ms): an absolute window selected on a chart; overrides `range`. */
export const windowFields = {
  from: emptyAsUndefined(z.coerce.number().int().positive().optional()),
  to: emptyAsUndefined(z.coerce.number().int().positive().optional()),
};

export function checkWindow(value: { from?: number; to?: number }, ctx: z.RefinementCtx): void {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['to'], message });
  if ((value.from === undefined) !== (value.to === undefined)) return issue('Give both from and to.');
  if (value.from === undefined || value.to === undefined) return;
  if (value.to <= value.from) return issue('to must be after from.');
  if (value.to - value.from > MAX_WINDOW_MS) return issue('A window can span at most 7 days.');
  if (value.from < Date.now() - MAX_WINDOW_AGE_MS) return issue(`from is older than ${RETENTION_MAX_DAYS} days.`);
}
