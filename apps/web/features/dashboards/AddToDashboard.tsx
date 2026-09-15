'use client';

import type { DashboardListResponse, DashboardResponse, DashboardSummary, NewDashboardWidget } from '@minidog/types';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import { withRange } from '@/lib/range-href';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import styles from './Dashboards.module.scss';

const NEW = 'new';

/** Saves the chart on screen to a dashboard, or to a new one. */
export function AddToDashboard({ widget }: { widget: NewDashboardWidget }) {
  const range = useTimeRange();
  const list = useApi<DashboardListResponse>('/dashboards', 60_000);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; href?: string; failed?: boolean } | null>(null);
  // Created here; used until the reloaded list includes it.
  const [created, setCreated] = useState<DashboardSummary | null>(null);
  const target = choice ?? list.data?.dashboards[0]?.id ?? NEW;

  const add = async () => {
    setBusy(true);
    setResult(null);
    try {
      let dashboard = list.data?.dashboards.find((item) => item.id === target) ?? (created?.id === target ? created : undefined);
      if (!dashboard) {
        const response = await apiFetch<DashboardResponse>('/dashboards', { method: 'POST', body: JSON.stringify({ name: 'My dashboard' }) });
        dashboard = { id: response.dashboard.id, name: response.dashboard.name, widgetCount: 0, updatedAt: response.dashboard.updatedAt };
        // Chosen at once: if adding the widget fails, a retry adds to this one instead of creating another.
        setCreated(dashboard);
        setChoice(dashboard.id);
        list.refetch();
      }
      await apiFetch<DashboardResponse>(`/dashboards/${dashboard.id}/widgets`, { method: 'POST', body: JSON.stringify({ widget }) });
      setResult({ text: `Added to ${dashboard.name}`, href: withRange(`/dashboards/${dashboard.id}`, range) });
      setChoice(dashboard.id);
      list.refetch();
    } catch (failure) {
      setResult({ text: toApiClientError(failure).message, failed: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.addTo}>
      <Select aria-label="Dashboard" value={target} onChange={(event) => setChoice(event.target.value)}>
        {list.data?.dashboards.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
        {created && !list.data?.dashboards.some((item) => item.id === created.id) && <option value={created.id}>{created.name}</option>}
        <option value={NEW}>New dashboard</option>
      </Select>
      {/* Until the list arrives, "New dashboard" would be picked by default and duplicate existing ones. */}
      <Button size="sm" loading={busy} disabled={!list.data} onClick={() => void add()}>
        Add to dashboard
      </Button>
      {result &&
        (result.href ? (
          <Link role="status" href={result.href}>
            {result.text}
          </Link>
        ) : (
          <span role="status" className={result.failed ? styles.error : undefined}>
            {result.text}
          </span>
        ))}
    </div>
  );
}
