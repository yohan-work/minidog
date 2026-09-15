'use client';

import {
  DASHBOARD_MAX_WIDGETS,
  type DashboardResponse,
  type DashboardWidget,
  type DashboardWidgetKind,
  type MetricAggregation,
  type MetricCatalogResponse,
  type MonitorListResponse,
  type NewDashboardWidget,
  type ServiceListResponse,
  type ServiceWidgetChart,
  type TimeRange,
  METRIC_AGGREGATIONS,
} from '@minidog/types';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { EmptyState, ErrorState } from '@/components/observability/States';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import { useQueryParams } from '@/lib/query-params';
import { withRange } from '@/lib/range-href';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { AGGREGATION_LABELS, defaultAggregation } from '../metrics/MetricsView';
import styles from './Dashboards.module.scss';
import { defaultTitle, WidgetFrame } from './widgets';

interface Draft {
  name: string;
  widgets: DashboardWidget[];
}

const newWidgetId = () => `w_${Math.random().toString(36).slice(2, 12)}`;

export function DashboardView({ id }: { id: string }) {
  const range = useTimeRange();
  const router = useRouter();
  const { get, set } = useQueryParams();
  const { data, error, refetch } = useApi<DashboardResponse>(`/dashboards/${id}`, 60_000);
  // Edits stay local until saved; the charts keep refreshing meanwhile.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const back = { href: withRange('/dashboards', range), label: 'Dashboards' };

  if (!data) {
    return (
      <>
        <PageHeader title="Dashboard" back={back} />
        {error ? <ErrorState title="Unable to load this dashboard." description={error.message} onRetry={refetch} /> : <Skeleton height="var(--chart-height)" />}
      </>
    );
  }

  const dashboard = data.dashboard;
  // A new dashboard opens ready for its first widgets (?edit=1).
  const editing = draft !== null || get('edit') === '1';
  const current: Draft = draft ?? { name: dashboard.name, widgets: dashboard.widgets };
  const change = (next: Partial<Draft>) => setDraft({ ...current, ...next });
  const stopEditing = () => {
    setDraft(null);
    setFormError(null);
    if (get('edit')) set({ edit: null });
  };

  const move = (index: number, by: -1 | 1) => {
    const widgets = [...current.widgets];
    const [widget] = widgets.splice(index, 1);
    widgets.splice(index + by, 0, widget!);
    change({ widgets });
  };
  const resize = (index: number) =>
    change({ widgets: current.widgets.map((widget, at) => (at === index ? { ...widget, size: widget.size === 'full' ? 'half' : 'full' } : widget)) });
  const remove = (index: number) => change({ widgets: current.widgets.filter((_, at) => at !== index) });
  const add = (widget: NewDashboardWidget) => change({ widgets: [...current.widgets, { ...widget, id: newWidgetId() } as DashboardWidget] });

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch<DashboardResponse>(`/dashboards/${id}`, { method: 'PUT', body: JSON.stringify(current) });
      refetch();
      stopEditing();
    } catch (failure) {
      const apiError = toApiClientError(failure);
      setFormError(apiError.validationIssues[0]?.message ?? apiError.message);
    } finally {
      setSaving(false);
    }
  };

  const destroy = async () => {
    if (!window.confirm(`Delete the dashboard "${dashboard.name}"? Its widgets are removed; the data they show is not.`)) return;
    await apiFetch(`/dashboards/${id}`, { method: 'DELETE' });
    router.push(back.href);
  };

  return (
    <>
      <PageHeader
        title={current.name}
        back={back}
        meta={`${current.widgets.length} ${current.widgets.length === 1 ? 'widget' : 'widgets'} · follows the time range above`}
        actions={
          editing ? (
            <>
              <Button variant="primary" loading={saving} onClick={() => void save()}>
                Save
              </Button>
              <Button variant="ghost" onClick={stopEditing}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void destroy()}>
                Delete
              </Button>
            </>
          ) : (
            <Button onClick={() => setDraft({ name: dashboard.name, widgets: dashboard.widgets })}>Edit</Button>
          )
        }
      />

      {editing && (
        <Section title="Edit dashboard">
          <div className={styles.form}>
            <Field id="dashboard-name" label="Name">
              <Input id="dashboard-name" value={current.name} onChange={(event) => change({ name: event.target.value })} maxLength={100} />
            </Field>
            <p className={`${styles.full} ${styles.note}`}>Move, resize or remove widgets with the buttons on each one, then Save.</p>
            {formError && <p className={`${styles.full} ${styles.error}`}>{formError}</p>}
          </div>
          <AddWidgetForm range={range} full={current.widgets.length >= DASHBOARD_MAX_WIDGETS} onAdd={add} />
        </Section>
      )}

      {current.widgets.length > 0 ? (
        <div className={styles.grid}>
          {current.widgets.map((widget, index) => (
            <WidgetFrame
              key={widget.id}
              widget={widget}
              range={range}
              controls={
                editing && (
                  <>
                    <Button size="sm" variant="ghost" aria-label="Move earlier" disabled={index === 0} onClick={() => move(index, -1)}>
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Move later" disabled={index === current.widgets.length - 1} onClick={() => move(index, 1)}>
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resize(index)}>
                      {widget.size === 'full' ? 'Half width' : 'Full width'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(index)}>
                      Remove
                    </Button>
                  </>
                )
              }
            />
          ))}
        </div>
      ) : (
        !editing && (
          <EmptyState
            title="No widgets yet"
            description="Add the charts you check most: a synthetic monitor, a service's requests or latency, or any metric."
            action={
              <Button size="sm" variant="primary" onClick={() => setDraft({ name: dashboard.name, widgets: [] })}>
                Add widgets
              </Button>
            }
          />
        )
      )}
    </>
  );
}

const KIND_LABELS: Record<DashboardWidgetKind, string> = {
  synthetic: 'Synthetic monitor',
  service: 'Service chart',
  metric: 'Metric',
};

function AddWidgetForm({ range, full, onAdd }: { range: TimeRange; full: boolean; onAdd: (widget: NewDashboardWidget) => void }) {
  const [kind, setKind] = useState<DashboardWidgetKind>('synthetic');
  const [monitorId, setMonitorId] = useState('');
  const [service, setService] = useState('');
  const [chart, setChart] = useState<ServiceWidgetChart>('requests');
  const [metric, setMetric] = useState('');
  const [aggregation, setAggregation] = useState<MetricAggregation | ''>('');
  const [host, setHost] = useState('');
  const [metricService, setMetricService] = useState('');

  const monitors = useApi<MonitorListResponse>(kind === 'synthetic' ? `/monitors?range=${range}` : null, 60_000);
  const services = useApi<ServiceListResponse>(kind === 'service' ? `/services?range=${range}` : null, 60_000);
  const catalog = useApi<MetricCatalogResponse>(kind === 'metric' ? `/metrics/catalog?range=${range}` : null, 60_000);
  const entry = catalog.data?.metrics.find((item) => item.name === metric);

  const widget: NewDashboardWidget | null =
    kind === 'synthetic'
      ? monitorId
        ? { kind, monitorId, size: 'half', title: monitors.data?.monitors.find((item) => item.id === monitorId)?.name ?? '' }
        : null
      : kind === 'service'
        ? service
          ? { kind, service, chart, size: 'half', title: '' }
          : null
        : metric
          ? { kind, metric, aggregation: aggregation || defaultAggregation(entry), service: metricService, host, groupBy: '', size: 'half', title: '' }
          : null;

  const reset = () => {
    setMonitorId('');
    setService('');
    setMetric('');
    setAggregation('');
    setHost('');
    setMetricService('');
  };

  return (
    <div className={styles.addWidget}>
      <h3 className={styles.subheading}>Add a widget</h3>
      <div className={styles.form}>
        <Field id="widget-kind" label="Shows">
          <Select id="widget-kind" value={kind} onChange={(event) => setKind(event.target.value as DashboardWidgetKind)}>
            {(Object.keys(KIND_LABELS) as DashboardWidgetKind[]).map((value) => (
              <option key={value} value={value}>
                {KIND_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        {kind === 'synthetic' && (
          <Field id="widget-monitor" label="Monitor" hint="Response time and availability.">
            <Select id="widget-monitor" value={monitorId} onChange={(event) => setMonitorId(event.target.value)}>
              <option value="">{monitors.data ? 'Choose a monitor' : 'Loading…'}</option>
              {monitors.data?.monitors.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {kind === 'service' && (
          <>
            <Field id="widget-service" label="Service">
              <Select id="widget-service" value={service} onChange={(event) => setService(event.target.value)}>
                <option value="">{services.data ? 'Choose a service' : 'Loading…'}</option>
                {services.data?.services.map((item) => (
                  <option key={item.service} value={item.service}>
                    {item.service}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="widget-chart" label="Chart">
              <Select id="widget-chart" value={chart} onChange={(event) => setChart(event.target.value as ServiceWidgetChart)}>
                <option value="requests">Requests and errors</option>
                <option value="latency">Latency (P50 / P95 / P99)</option>
              </Select>
            </Field>
          </>
        )}

        {kind === 'metric' && (
          <>
            <Field id="widget-metric" label="Metric" hint="For grouping by an attribute, use Add to dashboard on the Metrics page.">
              <Select
                id="widget-metric"
                value={metric}
                onChange={(event) => {
                  setMetric(event.target.value);
                  setAggregation('');
                  setHost('');
                  setMetricService('');
                }}
              >
                <option value="">{catalog.data ? 'Choose a metric' : 'Loading…'}</option>
                {catalog.data?.metrics.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="widget-aggregation" label="Aggregation">
              <Select id="widget-aggregation" value={aggregation || defaultAggregation(entry)} onChange={(event) => setAggregation(event.target.value as MetricAggregation)}>
                {METRIC_AGGREGATIONS.map((value) => (
                  <option key={value} value={value}>
                    {AGGREGATION_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="widget-host" label="Host">
              <Select id="widget-host" value={host} onChange={(event) => setHost(event.target.value)}>
                <option value="">All hosts</option>
                {entry?.hosts.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="widget-metric-service" label="Service">
              <Select id="widget-metric-service" value={metricService} onChange={(event) => setMetricService(event.target.value)}>
                <option value="">All services</option>
                {entry?.services.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <div className={styles.actions}>
          <Button
            disabled={!widget || full}
            onClick={() => {
              if (!widget) return;
              onAdd(widget);
              reset();
            }}
          >
            Add widget
          </Button>
          {widget && <span className={styles.note}>{widget.title || defaultTitle(widget)}</span>}
          {full && <span className={styles.error}>This dashboard is full ({DASHBOARD_MAX_WIDGETS} widgets).</span>}
        </div>
      </div>
    </div>
  );
}
