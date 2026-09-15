'use client';

import type { LogEntry, LogTailResponse, TimeRange } from '@minidog/types';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Section } from '@/components/layout/Section';
import { LogList } from '@/components/observability/LogList';
import { EmptyState, ErrorState } from '@/components/observability/States';
import { Button } from '@/components/ui/Button';
import { apiFetch, toApiClientError, type ApiClientError } from '@/lib/api-client';
import { formatCount } from '@/lib/format';
import { mergeTail, nextSince, TAIL_INTERVAL_MS, TAIL_START_LOOKBACK_MS } from '@/lib/log-tail';
import { toQuery } from '@/lib/query-params';
import styles from './Logs.module.scss';

export interface TailFilters {
  service: string | null;
  level: string | null;
  q: string | null;
}

interface LiveTailProps {
  filters: TailFilters;
  range: TimeRange;
  /** Next step while nothing arrives, e.g. clearing filters. */
  emptyAction: ReactNode;
}

/**
 * Polls for new records every 2 s while the tab is visible and prepends them.
 * Changing a filter starts over; pausing freezes the list and resuming catches up.
 */
export function LiveTail({ filters, range, emptyAction }: LiveTailProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [error, setError] = useState<ApiClientError>();
  const [attempt, setAttempt] = useState(0);
  const sinceRef = useRef<number | null>(null);
  const filterKey = toQuery({ ...filters });

  useEffect(() => {
    setLogs([]);
    setLoaded(false);
    setSkipped(false);
    sinceRef.current = null;
  }, [filterKey]);

  useEffect(() => {
    if (paused) return;
    const controller = new AbortController();
    let timer: number | undefined;

    const poll = async () => {
      if (document.visibilityState === 'visible') {
        const since = sinceRef.current ?? Date.now() - TAIL_START_LOOKBACK_MS;
        try {
          const data = await apiFetch<LogTailResponse>(`/logs/tail${toQuery({ ...filters, since })}`, { signal: controller.signal });
          setLogs((buffer) => mergeTail(buffer, data.logs, data.since, data.truncated));
          setSkipped(data.truncated);
          setLoaded(true);
          setError(undefined);
          sinceRef.current = nextSince(data.now);
        } catch (failure) {
          if (controller.signal.aborted) return;
          setError(toApiClientError(failure));
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, TAIL_INTERVAL_MS);
    };

    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // `filterKey` stands for `filters`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, filterKey, attempt]);

  const state = paused ? 'paused' : error ? 'error' : 'live';
  const retry = () => {
    setError(undefined);
    setAttempt((value) => value + 1);
  };

  return (
    <Section
      title="Live tail"
      flush
      actions={
        <>
          <span className={styles.liveStatus}>
            <span className={styles.liveDot} data-state={state} aria-hidden />
            {/* Announces state changes only, not every new record. */}
            <span role="status">{state === 'paused' ? 'Paused' : state === 'error' ? 'Reconnecting…' : 'Live'}</span>
            <span>· {formatCount(logs.length)} records</span>
          </span>
          <Button size="sm" onClick={() => setPaused((value) => !value)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </>
      }
    >
      {skipped && !paused && <p className={styles.notice}>More than 500 records arrived at once; some older ones are not shown.</p>}
      {logs.length > 0 ? (
        <LogList logs={logs} range={range} />
      ) : error && !loaded ? (
        <ErrorState title="Unable to tail logs." description={error.message} onRetry={retry} />
      ) : (
        <EmptyState
          title={loaded ? 'Waiting for new records' : 'Connecting…'}
          description="Records matching the filters appear here as they arrive, newest first."
          action={emptyAction}
        />
      )}
    </Section>
  );
}
