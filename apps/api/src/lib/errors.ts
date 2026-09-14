import type { ApiErrorResponse } from '@minidog/types';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NotFoundError extends HttpError {
  constructor(resource: string) {
    super(404, 'not_found', `${resource} not found.`);
  }
}

/** Raised when ClickHouse cannot be reached. Metadata (SQLite) keeps working. */
export class ClickHouseUnavailableError extends HttpError {
  constructor(cause: unknown) {
    super(503, 'clickhouse_unavailable', 'ClickHouse did not respond.');
    this.cause = cause;
  }
}

export function errorBody(code: string, message: string, details?: unknown): ApiErrorResponse {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}
