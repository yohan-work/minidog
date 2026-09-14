'use client';

import type { LogEntry, LogLevel, TimeRange } from '@minidog/types';
import Link from 'next/link';
import { useState } from 'react';
import { formatDateTime, formatTimeMs } from '@/lib/format';
import { serviceHref, traceHref } from '@/lib/links';
import styles from './LogList.module.scss';

const LEVEL_LABELS: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  fatal: 'FATAL',
};

export function LevelLabel({ level }: { level: LogLevel }) {
  return (
    <span className={styles.level} data-level={level}>
      {LEVEL_LABELS[level]}
    </span>
  );
}

interface LogListProps {
  logs: readonly LogEntry[];
  range: TimeRange;
  /** Hide when every record comes from one known service. */
  showService?: boolean;
  /** Hide the trace link when the list is already scoped to one trace. */
  showTrace?: boolean;
}

/**
 * Reads like a log file: time, level, service and message on one line.
 * A row expands to its attributes; the trace link jumps to the request.
 */
export function LogList({ logs, range, showService = true, showTrace = true }: LogListProps) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <ol className={styles.list} aria-label="Log records">
      {logs.map((log, index) => {
        const expanded = open.has(index);
        const detailsId = `log-${index}-details`;
        return (
          <li key={`${log.timestamp}-${index}`} className={styles.item} data-level={log.level}>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.toggle}
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => toggle(index)}
              >
                <time className={styles.time} dateTime={new Date(log.timestamp).toISOString()} title={formatDateTime(log.timestamp)}>
                  {formatTimeMs(log.timestamp)}
                </time>
                <LevelLabel level={log.level} />
                {showService && <span className={styles.service}>{log.service || 'unknown'}</span>}
                <span className={styles.message}>{log.body}</span>
              </button>
              {showTrace && log.traceId && (
                <Link href={traceHref(log.traceId, range, log.spanId || undefined)} className={styles.traceLink}>
                  trace {log.traceId.slice(0, 7)}
                </Link>
              )}
            </div>
            {expanded && (
              <div id={detailsId} className={styles.details}>
                <p className={styles.body}>{log.body}</p>
                <dl className={styles.attributes}>
                  <Attribute name="service">
                    {log.service ? <Link href={serviceHref(log.service, range)}>{log.service}</Link> : '—'}
                  </Attribute>
                  {log.host && <Attribute name="host">{log.host}</Attribute>}
                  {log.traceId && (
                    <Attribute name="trace">
                      <Link href={traceHref(log.traceId, range, log.spanId || undefined)}>{log.traceId}</Link>
                    </Attribute>
                  )}
                  {log.spanId && <Attribute name="span">{log.spanId}</Attribute>}
                  {Object.entries(log.attributes)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, value]) => (
                      <Attribute key={key} name={key}>
                        {value}
                      </Attribute>
                    ))}
                </dl>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Attribute({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className={styles.attribute}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}
