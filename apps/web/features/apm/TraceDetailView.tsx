'use client';

import type { LogListResponse, SpanDetail, TimeRange, TraceResponse } from '@minidog/types';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { LogList } from '@/components/observability/LogList';
import { EmptyState, ErrorState } from '@/components/observability/States';
import { StatusIndicator } from '@/components/observability/StatusIndicator';
import { buildWaterfall, TraceWaterfall } from '@/components/observability/TraceWaterfall';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDateTime, formatLatency, formatTimeMs } from '@/lib/format';
import { logsHref, serviceHref, tracesHref } from '@/lib/links';
import { useQueryParams } from '@/lib/query-params';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { hostHref } from '../infrastructure/host';
import styles from './Apm.module.scss';

/** Traces rarely change after they arrive; poll slowly for late spans. */
const REFRESH_MS = 30_000;

export function TraceDetailView({ traceId }: { traceId: string }) {
  const range = useTimeRange();
  const { get, set } = useQueryParams();
  // When the trace was seen, from the row that linked here; narrows the lookup to those days.
  const at = get('at');
  const hint = at && /^\d+$/.test(at) ? `&at=${at}` : '';
  const trace = useApi<TraceResponse>(`/traces/${traceId}${hint ? `?${hint.slice(1)}` : ''}`, REFRESH_MS);
  const logs = useApi<LogListResponse>(`/logs?traceId=${traceId}&limit=500${hint}`, REFRESH_MS);
  const back = { href: tracesHref({}, range), label: 'Traces' };

  const model = useMemo(() => (trace.data ? buildWaterfall(trace.data.spans) : null), [trace.data]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [spanQuery, setSpanQuery] = useState('');
  const toggle = (spanId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(spanId)) next.add(spanId);
      return next;
    });
  const parents = model?.rows.filter((row) => row.childCount > 0) ?? [];
  const allCollapsed = parents.length > 0 && parents.every((row) => collapsed.has(row.span.spanId));

  if (trace.error?.status === 404) {
    return (
      <>
        <PageHeader title="Trace not found" back={back} />
        <EmptyState
          title="No spans with this trace id."
          description="Spans are kept for 14 days. The trace may also still be arriving."
          action={<ButtonLink href={back.href}>Back to Traces</ButtonLink>}
        />
      </>
    );
  }

  if (!model || !trace.data) {
    return (
      <>
        <PageHeader title={<Skeleton width="calc(var(--space-16) * 3)" height="var(--text-page)" />} back={back} />
        {trace.error ? (
          <ErrorState title="Unable to load trace." description={trace.error.message} onRetry={trace.refetch} />
        ) : (
          <Section title="Waterfall">
            <Skeleton height="calc(var(--row-height) * 6)" />
          </Section>
        )}
      </>
    );
  }

  const root = model.rows[0]?.span;
  const selectedId = get('span') || model.slowestSpanId || root?.spanId || null;
  const selected = trace.data.spans.find((span) => span.spanId === selectedId) ?? root;
  const errors = trace.data.spans.filter((span) => span.status === 'error').length;
  const services = new Set(trace.data.spans.map((span) => span.service));
  const traceLogs = logs.data?.logs ?? [];
  const spanLogs = selected ? traceLogs.filter((log) => log.spanId === selected.spanId) : [];

  return (
    <>
      <PageHeader
        back={back}
        title={root?.name ?? traceId}
        status={
          errors > 0 ? (
            <StatusIndicator status="down" label={`${errors} error${errors === 1 ? '' : 's'}`} />
          ) : (
            <StatusIndicator status="up" label="OK" />
          )
        }
        meta={
          <>
            <span className={styles.mono}>{formatLatency(model.durationMs)}</span>
            <Separator />
            <span>
              {trace.data.spans.length} spans · {services.size} service{services.size === 1 ? '' : 's'}
            </span>
            <Separator />
            <span>{formatDateTime(model.startMs)}</span>
            <Separator />
            <span className={styles.mono}>{traceId}</span>
          </>
        }
      />

      <Section
        title="Waterfall"
        actions={
          <div className={styles.waterfallTools}>
            <label className={styles.spanSearch}>
              <span className={styles.visuallyHidden}>Find spans</span>
              <Input
                type="search"
                placeholder="Find spans…"
                value={spanQuery}
                onChange={(event) => setSpanQuery(event.target.value)}
              />
            </label>
            {parents.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={spanQuery.trim() !== ''}
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parents.map((row) => row.span.spanId)))}
              >
                {allCollapsed ? 'Expand all' : 'Collapse all'}
              </Button>
            )}
          </div>
        }
        flush
      >
        <TraceWaterfall
          model={model}
          selectedSpanId={selected?.spanId ?? null}
          onSelect={(span) => set({ span })}
          collapsed={collapsed}
          onToggle={toggle}
          query={spanQuery}
        />
      </Section>

      {selected && (
        <Section title={`Span · ${selected.name}`}>
          <SpanDetails span={selected} traceStartMs={model.startMs} range={range} />
          <h3 className={styles.subheading}>Logs from this span {logs.data && `(${spanLogs.length})`}</h3>
          {spanLogs.length > 0 ? (
            <LogList logs={spanLogs} range={range} showTrace={false} />
          ) : (
            <p className={styles.note}>{logs.data ? 'No logs were emitted inside this span.' : 'Loading logs…'}</p>
          )}
        </Section>
      )}

      <Section
        title={
          <>
            Related logs <span className={styles.count}>{trace.data.logCount}</span>
          </>
        }
        actions={
          <ButtonLink href={logsHref({ traceId, at: model.startMs }, range)} variant="ghost" size="sm">
            Open in Logs
          </ButtonLink>
        }
        flush
      >
        {logs.data ? (
          traceLogs.length > 0 ? (
            <LogList logs={traceLogs} range={range} showTrace={false} />
          ) : (
            <EmptyState
              title="No logs for this trace"
              description="Logs carry a trace id when they are emitted inside an active span."
              action={
                root ? (
                  <ButtonLink href={logsHref({ service: root.service }, range)}>View logs of {root.service}</ButtonLink>
                ) : null
              }
            />
          )
        ) : logs.error ? (
          <ErrorState title="Unable to load logs." description={logs.error.message} onRetry={logs.refetch} />
        ) : (
          <Skeleton height="calc(var(--row-height) * 3)" />
        )}
      </Section>
    </>
  );
}

function Separator() {
  return (
    <span className={styles.metaSeparator} aria-hidden>
      ·
    </span>
  );
}

function SpanDetails({ span, traceStartMs, range }: { span: SpanDetail; traceStartMs: number; range: TimeRange }) {
  const attributes = Object.entries(span.attributes).sort(([a], [b]) => a.localeCompare(b));
  const resource = Object.entries(span.resourceAttributes).sort(([a], [b]) => a.localeCompare(b));
  return (
    <>
      <dl className={styles.facts}>
        <Fact name="Service">
          <Link href={serviceHref(span.service, range)}>{span.service}</Link>
        </Fact>
        <Fact name="Duration">{formatLatency(span.durationMs)}</Fact>
        <Fact name="Start">
          +{formatLatency(span.startMs - traceStartMs)} · {formatTimeMs(span.startMs)}
        </Fact>
        <Fact name="Kind">{span.kind}</Fact>
        <Fact name="Status">
          {span.status === 'error' ? (
            <span className={styles.error}>error{span.statusMessage && ` — ${span.statusMessage}`}</span>
          ) : (
            span.status
          )}
        </Fact>
        {span.httpMethod && (
          <Fact name="HTTP">
            {span.httpMethod} {span.httpRoute} {span.httpStatus ?? ''}
          </Fact>
        )}
        {span.dbSystem && <Fact name="Database">{span.dbSystem}</Fact>}
        {span.host && (
          <Fact name="Host">
            <Link href={hostHref(span.host, range)}>{span.host}</Link>
          </Fact>
        )}
      </dl>

      {span.events.length > 0 && (
        <>
          <h3 className={styles.subheading}>Events</h3>
          <ul className={styles.events}>
            {span.events.map((event, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a span can record the same event name twice; the list is fixed for a trace.
              <li key={`${event.name}-${index}`} className={styles.event}>
                <span className={styles.eventName}>
                  {event.name}
                  {event.timeUnixMs !== null && ` · +${formatLatency(event.timeUnixMs - traceStartMs)}`}
                </span>
                {event.attributes['exception.message'] && (
                  <span className={styles.error}>{event.attributes['exception.message']}</span>
                )}
                {event.attributes['exception.stacktrace'] && (
                  <pre className={styles.stack}>{event.attributes['exception.stacktrace']}</pre>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className={styles.subheading}>Attributes</h3>
      {attributes.length > 0 ? <KeyValues entries={attributes} /> : <p className={styles.note}>No attributes.</p>}

      {resource.length > 0 && (
        <details className={styles.resource}>
          <summary>Resource attributes ({resource.length})</summary>
          <KeyValues entries={resource} />
        </details>
      )}
    </>
  );
}

function Fact({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function KeyValues({ entries }: { entries: readonly (readonly [string, string])[] }) {
  return (
    <dl className={styles.kv}>
      {entries.map(([key, value]) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt title={key}>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
