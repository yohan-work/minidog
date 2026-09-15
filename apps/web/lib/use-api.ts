'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, toApiClientError, type ApiClientError } from './api-client';

export const DEFAULT_REFRESH_MS = 15_000;

export interface ApiState<T> {
  data: T | undefined;
  /** Error of the latest attempt. Data from an earlier success is kept (stale). */
  error: ApiClientError | undefined;
  /** First load: neither data nor error yet. */
  isLoading: boolean;
  /** Epoch ms of the last successful load. */
  updatedAt: number | undefined;
  refetch: () => void;
}

/**
 * Loads `/api{path}` and polls while the tab is visible. Previous data stays on
 * screen while a new path loads, so changing the time range never blanks the page.
 */
export function useApi<T>(path: string | null, refreshMs: number = DEFAULT_REFRESH_MS): ApiState<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiClientError; updatedAt?: number }>({});
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is not read; changing it (refetch) re-runs the load.
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();

    const load = async () => {
      try {
        const data = await apiFetch<T>(path, { signal: controller.signal });
        setState({ data, error: undefined, updatedAt: Date.now() });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((previous) => ({ ...previous, error: toApiClientError(error) }));
      }
    };

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, refreshMs);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [path, refreshMs, nonce]);

  const refetch = useCallback(() => setNonce((value) => value + 1), []);

  return {
    data: state.data,
    error: state.error,
    isLoading: state.data === undefined && state.error === undefined,
    updatedAt: state.updatedAt,
    refetch,
  };
}
