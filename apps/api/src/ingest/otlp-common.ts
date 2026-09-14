import { HttpError } from '../lib/errors';
import type { Scope } from '../repositories/project-repository';

// OTLP/JSON (protobuf JSON mapping). Only the fields minidog reads are typed;
// 64-bit integers arrive as strings.
export interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  bytesValue?: string;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
}

export interface KeyValue {
  key?: string;
  value?: AnyValue;
}

/** Columns every telemetry row carries, taken from the resource. */
export interface ResourceContext {
  project_id: string;
  environment: string;
  service: string;
  host: string;
  resource_attributes: Record<string, string>;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rejects bodies that are not an OTLP export request (`field` holds the resource list). */
export function assertExportRequest(body: unknown, field: string, requestName: string): void {
  if (!isObject(body) || (body[field] !== undefined && !Array.isArray(body[field]))) {
    throw new HttpError(400, 'invalid_otlp', `Expected an OTLP ${requestName} in JSON encoding.`);
  }
}

/**
 * Project and environment come from the ingest scope; the resource may name a
 * different environment with `deployment.environment(.name)`.
 */
export function resourceContext(attributes: readonly KeyValue[] | undefined, scope: Scope): ResourceContext {
  const resource = toAttributes(attributes);
  return {
    project_id: scope.projectId,
    environment: resource['deployment.environment.name'] || resource['deployment.environment'] || scope.environment,
    service: resource['service.name'] ?? '',
    host: resource['host.name'] ?? '',
    resource_attributes: resource,
  };
}

export function toAttributes(list: readonly KeyValue[] | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const item of list ?? []) {
    if (item.key) attributes[item.key] = anyValueToString(item.value);
  }
  return attributes;
}

export function anyValueToString(value: AnyValue | undefined): string {
  if (!value) return '';
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return String(value.boolValue);
  if (value.intValue !== undefined) return String(value.intValue);
  if (value.doubleValue !== undefined) return String(value.doubleValue);
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue) return JSON.stringify((value.arrayValue.values ?? []).map(anyValueToString));
  if (value.kvlistValue) return JSON.stringify(toAttributes(value.kvlistValue.values));
  return '';
}

/** Parses a `*UnixNano` field; null when missing, malformed or zero. */
export function parseNanos(value: string | number | undefined): bigint | null {
  if (value === undefined) return null;
  try {
    const nanos = BigInt(String(value));
    return nanos > 0n ? nanos : null;
  } catch {
    return null;
  }
}

export function msToNanos(ms: number): bigint {
  return BigInt(Math.round(ms)) * 1_000_000n;
}

/** `2026-09-14 12:00:00.123456` in UTC, as expected by DateTime64(6, 'UTC'). */
export function nanosToDateTime64(nanos: bigint): string {
  const seconds = nanos / 1_000_000_000n;
  const micros = (nanos % 1_000_000_000n) / 1_000n;
  const base = new Date(Number(seconds) * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return `${base}.${micros.toString().padStart(6, '0')}`;
}

/**
 * OTLP/JSON encodes trace and span ids as hex; some protobuf-JSON encoders
 * emit base64 instead. Returns lowercase hex, or '' for absent/all-zero ids.
 */
export function normalizeId(value: string | undefined, bytes: 8 | 16): string {
  if (!value) return '';
  let hex = '';
  if (value.length === bytes * 2 && /^[0-9a-f]+$/i.test(value)) {
    hex = value.toLowerCase();
  } else {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === bytes) hex = decoded.toString('hex');
  }
  return /^0*$/.test(hex) ? '' : hex;
}
