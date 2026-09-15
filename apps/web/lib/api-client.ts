import type { ApiErrorResponse, ValidationIssue } from '@minidog/types';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  get validationIssues(): ValidationIssue[] {
    return this.code === 'validation_error' && Array.isArray(this.details) ? (this.details as ValidationIssue[]) : [];
  }
}

let redirecting = false;

/** Sends the browser to sign in, then back to where it was. */
function redirectToLogin(): void {
  if (typeof window === 'undefined' || redirecting || window.location.pathname === '/login') return;
  redirecting = true;
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  // Marks requests as the dashboard's; the API refuses changes without it (cross-site forms cannot add it).
  headers.set('x-minidog-request', '1');

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers, cache: 'no-store' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError(0, 'network_error', 'Unable to reach the dashboard server.');
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as Partial<ApiErrorResponse> | null)?.error;
    if (response.status === 401 && error?.code === 'unauthenticated') redirectToLogin();
    if (error?.code) throw new ApiClientError(response.status, error.code, error.message, error.details);
    // Anything without our JSON error body (a proxy or gateway page, say) gets a generic message.
    throw new ApiClientError(
      response.status,
      'api_unavailable',
      response.status >= 500 ? 'The Query API did not respond.' : `Request failed with status ${response.status}.`,
    );
  }
  return body as T;
}

export function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  return new ApiClientError(0, 'unknown_error', error instanceof Error ? error.message : 'Unexpected error.');
}
