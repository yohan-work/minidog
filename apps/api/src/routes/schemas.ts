import {
  DEFAULT_TIME_RANGE,
  MONITOR_BODY_CONTAINS_MAX,
  MONITOR_DEFAULTS,
  MONITOR_INTERVALS_SECONDS,
  MONITOR_TIMEOUT_MS,
  TIME_RANGE_KEYS,
} from '@minidog/types';
import { z } from 'zod';
import { formatExpectedStatus, parseExpectedStatus } from '../services/expected-status';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const fields = {
  name: z.string().trim().min(1, 'Name is required.').max(100, 'Use at most 100 characters.'),
  url: z.string().trim().max(2048, 'URL is too long.').refine(isHttpUrl, 'Enter an http:// or https:// URL.'),
  method: z.enum(['GET', 'HEAD']),
  intervalSeconds: z
    .number()
    .int()
    .refine((value) => (MONITOR_INTERVALS_SECONDS as readonly number[]).includes(value), 'Unsupported interval.'),
  timeoutMs: z
    .number()
    .int()
    .min(MONITOR_TIMEOUT_MS.min, `Timeout must be at least ${MONITOR_TIMEOUT_MS.min} ms.`)
    .max(MONITOR_TIMEOUT_MS.max, `Timeout must be at most ${MONITOR_TIMEOUT_MS.max} ms.`),
  expectedStatus: z
    .string()
    .trim()
    .refine((value) => parseExpectedStatus(value) !== null, 'Use status codes or ranges, e.g. 200-299,301.')
    .transform((value) => formatExpectedStatus(parseExpectedStatus(value)!)),
  followRedirects: z.boolean(),
  bodyContains: z.string().trim().max(MONITOR_BODY_CONTAINS_MAX, `Use at most ${MONITOR_BODY_CONTAINS_MAX} characters.`),
};

/** HEAD responses have no body to search. */
const bodyCheckAllowed = (value: { method: string; bodyContains?: string }) => !(value.method === 'HEAD' && value.bodyContains);
// Issues are built per use: zod's refine() deletes `message` from the object it is given.
const bodyCheckIssue = () => ({ message: 'A body check needs GET; HEAD responses have no body.', path: ['bodyContains'] });

const timeoutWithinInterval = (value: { timeoutMs: number; intervalSeconds: number }) =>
  value.timeoutMs < value.intervalSeconds * 1000;
const timeoutIssue = () => ({ message: 'Timeout must be shorter than the interval.', path: ['timeoutMs'] });

export const createMonitorSchema = z
  .object({
    name: z.string().trim().max(100, 'Use at most 100 characters.').optional(),
    url: fields.url,
    method: fields.method.default(MONITOR_DEFAULTS.method),
    intervalSeconds: fields.intervalSeconds.default(MONITOR_DEFAULTS.intervalSeconds),
    timeoutMs: fields.timeoutMs.default(MONITOR_DEFAULTS.timeoutMs),
    expectedStatus: fields.expectedStatus.default(MONITOR_DEFAULTS.expectedStatus),
    followRedirects: fields.followRedirects.default(MONITOR_DEFAULTS.followRedirects),
    bodyContains: fields.bodyContains.default(MONITOR_DEFAULTS.bodyContains),
  })
  .refine(timeoutWithinInterval, timeoutIssue())
  .refine(bodyCheckAllowed, bodyCheckIssue())
  .transform(({ name, ...rest }) => ({ ...rest, name: name || new URL(rest.url).host }));

export const updateMonitorSchema = z
  .object({
    name: fields.name,
    url: fields.url,
    method: fields.method,
    intervalSeconds: fields.intervalSeconds,
    timeoutMs: fields.timeoutMs,
    expectedStatus: fields.expectedStatus,
    followRedirects: fields.followRedirects,
    bodyContains: fields.bodyContains,
    enabled: z.boolean(),
  })
  .partial()
  .strict();

export { bodyCheckAllowed, bodyCheckIssue, timeoutIssue, timeoutWithinInterval };

export const idParamsSchema = z.object({ id: z.string().min(1).max(64) });

export const rangeQuerySchema = z.object({
  range: z.enum(TIME_RANGE_KEYS).default(DEFAULT_TIME_RANGE),
});

export const checksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
