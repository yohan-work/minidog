'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import type { ApiClientError } from './api-client';
import { type ApiSnapshot, apiStore, EMPTY_SNAPSHOT } from './api-store';

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

const noop = () => {};

/**
 * Loads `/api{path}` and polls while the tab is visible. Components asking
 * for the same path share one request and one timer (see `ApiStore`), and a
 * path that was loaded before shows its last response at once while the
 * fresh one arrives. Previous data stays on screen while a new path loads,
 * so changing the time range never blanks the page.
 */
export function useApi<T>(path: string | null, refreshMs: number = DEFAULT_REFRESH_MS): ApiState<T> {
  const subscribe = useCallback(
    (onChange: () => void) => (path ? apiStore.subscribe(path, refreshMs, onChange) : noop),
    [path, refreshMs],
  );
  const getSnapshot = useCallback(() => (path ? apiStore.peek<T>(path) : EMPTY_SNAPSHOT), [path]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A path that has not answered yet leaves the previous path's response on screen.
  const [shown, setShown] = useState<ApiSnapshot<T>>(snapshot);
  if (snapshot !== shown && (snapshot.data !== undefined || snapshot.error !== undefined)) setShown(snapshot);

  const refetch = useCallback(() => {
    if (path) apiStore.refetch(path);
  }, [path]);

  return {
    data: shown.data,
    error: shown.error,
    isLoading: shown.data === undefined && shown.error === undefined,
    updatedAt: shown.updatedAt,
    refetch,
  };
}
