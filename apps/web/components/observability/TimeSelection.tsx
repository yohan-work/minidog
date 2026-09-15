'use client';

import type { TimeRange } from '@minidog/types';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { toQuery } from '@/lib/query-params';
import { withRange } from '@/lib/range-href';
import styles from './TimeSelection.module.scss';

/** An absolute window, e.g. dragged on a chart. Epoch milliseconds. */
export interface TimeWindowSelection {
  fromMs: number;
  toMs: number;
}

const dayTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

/** `Sep 15, 09:01 – 09:14`, or with both dates when the window crosses midnight. */
export function formatWindow({ fromMs, toMs }: TimeWindowSelection): string {
  const sameDay = new Date(fromMs).toDateString() === new Date(toMs).toDateString();
  return `${dayTime.format(fromMs)} – ${sameDay ? time.format(toMs) : dayTime.format(toMs)}`;
}

/** `?from=&to=` → selection; null when absent or malformed. */
export function parseWindow(from: string, to: string): TimeWindowSelection | null {
  const fromMs = Number(from);
  const toMs = Number(to);
  if (!from || !to || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return null;
  return { fromMs, toMs };
}

export function windowParams({ fromMs, toMs }: TimeWindowSelection): { from: string; to: string } {
  return { from: String(Math.floor(fromMs)), to: String(Math.ceil(toMs)) };
}

export interface DrilldownLink {
  label: string;
  href: string;
}

/**
 * Where to look next for a window: its slowest and failed requests, error logs
 * and exceptions. The range is kept so clearing the window returns to it.
 */
export function drilldownLinks(selection: TimeWindowSelection, range: TimeRange, service?: string): DrilldownLink[] {
  const scope = { ...(service ? { service } : {}), ...windowParams(selection) };
  return [
    { label: 'Slowest traces', href: withRange(`/traces${toQuery({ ...scope, sort: 'slowest' })}`, range) },
    { label: 'Error traces', href: withRange(`/traces${toQuery({ ...scope, status: 'error' })}`, range) },
    { label: 'Error logs', href: withRange(`/logs${toQuery({ ...scope, level: 'error' })}`, range) },
    { label: 'Exceptions', href: withRange(`/errors${toQuery(scope)}`, range) },
  ];
}

/** Shown above a chart after dragging across it. */
export function SelectionBar({
  selection,
  links,
  onClear,
}: {
  selection: TimeWindowSelection;
  links: readonly DrilldownLink[];
  onClear: () => void;
}) {
  return (
    <div className={styles.bar} role="status">
      <span className={styles.window}>
        <span className={styles.label}>Selected</span>
        {formatWindow(selection)}
      </span>
      <nav className={styles.links} aria-label="Investigate this window">
        {links.map((link) => (
          <Link key={link.label} href={link.href} className={styles.link}>
            {link.label}
            <Icon name="arrow-right" size={12} />
          </Link>
        ))}
      </nav>
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

/** Tells the reader that the chart is selectable. */
export function SelectHint() {
  return <span className={styles.hint}>Drag across the chart to investigate a window</span>;
}

/** One chart selection per page; the bar shows above the chart it was made on. */
export function useChartSelection<Source extends string>() {
  const [state, setState] = useState<{ source: Source; selection: TimeWindowSelection } | null>(null);
  return {
    selectionFor: (source: Source) => (state?.source === source ? state.selection : null),
    select: (source: Source) => (fromMs: number, toMs: number) => setState({ source, selection: { fromMs, toMs } }),
    clear: () => setState(null),
  };
}
