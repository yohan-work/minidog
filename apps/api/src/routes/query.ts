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
