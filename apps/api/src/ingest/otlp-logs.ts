import { LOG_LEVELS, type LogLevel } from '@minidog/types';
import type { Scope } from '../repositories/project-repository';
import {
  anyValueToString,
  assertExportRequest,
  msToNanos,
  nanosToDateTime64,
  normalizeId,
  parseNanos,
  resourceContext,
  toAttributes,
  type AnyValue,
  type KeyValue,
  type ResourceContext,
} from './otlp-common';

/** Row shape of `logs` as written with JSONEachRow. */
export interface LogRow extends ResourceContext {
  timestamp: string;
  level: LogLevel;
  severity_text: string;
  severity_number: number;
  body: string;
  trace_id: string;
  span_id: string;
  attributes: Record<string, string>;
}

interface OtlpLogRecord {
  timeUnixNano?: string | number;
  observedTimeUnixNano?: string | number;
  severityNumber?: number | string;
  severityText?: string;
  body?: AnyValue;
  attributes?: KeyValue[];
  traceId?: string;
  spanId?: string;
}

interface ExportLogsRequest {
  resourceLogs?: {
    resource?: { attributes?: KeyValue[] };
    scopeLogs?: { logRecords?: OtlpLogRecord[] }[];
  }[];
}

const SEVERITY_BASE: Record<string, number> = { TRACE: 1, DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 };

const TEXT_LEVELS: Record<string, LogLevel> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  information: 'info',
  notice: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'fatal',
  critical: 'fatal',
  crit: 'fatal',
  alert: 'fatal',
  emergency: 'fatal',
  panic: 'fatal',
};

/** OTLP severity number 1–24 from a number or a `SEVERITY_NUMBER_WARN2`-style name; 0 when unknown. */
export function severityNumber(value: number | string | undefined): number {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 24 ? value : 0;
  if (typeof value !== 'string') return 0;
  if (/^\d+$/.test(value)) return severityNumber(Number(value));
  const match = /^SEVERITY_NUMBER_([A-Z]+)(\d)?$/.exec(value);
  const base = match ? SEVERITY_BASE[match[1]!] : undefined;
  if (base === undefined) return 0;
  return base + (match?.[2] ? Number(match[2]) - 1 : 0);
}

/** Each OTLP severity range of four numbers maps to one level; text is the fallback. */
export function toLevel(number: number, text: string): LogLevel {
  if (number > 0) return LOG_LEVELS[Math.min(Math.floor((number - 1) / 4), LOG_LEVELS.length - 1)]!;
  return TEXT_LEVELS[text.trim().toLowerCase()] ?? 'info';
}

/** Normalizes an OTLP ExportLogsServiceRequest (JSON encoding). */
export function parseOtlpLogs(
  body: unknown,
  scope: Scope,
  now: number = Date.now(),
): { rows: LogRow[]; rejected: number } {
  assertExportRequest(body, 'resourceLogs', 'ExportLogsServiceRequest');

  const rows: LogRow[] = [];
  for (const resourceLogs of (body as ExportLogsRequest).resourceLogs ?? []) {
    const context = resourceContext(resourceLogs.resource?.attributes, scope);

    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      for (const record of scopeLogs.logRecords ?? []) {
        const time = parseNanos(record.timeUnixNano) ?? parseNanos(record.observedTimeUnixNano) ?? msToNanos(now);
        const number = severityNumber(record.severityNumber);
        const text = record.severityText ?? '';
        rows.push({
          ...context,
          timestamp: nanosToDateTime64(time),
          level: toLevel(number, text),
          severity_text: text,
          severity_number: number,
          body: anyValueToString(record.body),
          trace_id: normalizeId(record.traceId, 16),
          span_id: normalizeId(record.spanId, 8),
          attributes: toAttributes(record.attributes),
        });
      }
    }
  }
  return { rows, rejected: 0 };
}
