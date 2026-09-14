'use client';

import {
  ALERT_WINDOWS_MINUTES,
  type AlertMonitor,
  type AlertMonitorResponse,
  type HostResponse,
  type ServiceResponse,
  type TimeRange,
} from '@minidog/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { Metric, MetricGrid } from '@/components/observability/Metric';
import { EmptyState, ErrorState, StaleNotice } from '@/components/observability/States';
import { ChartLegend, TimeSeriesChart, type ChartSeries } from '@/components/observability/TimeSeriesChart';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';
import { serviceHref } from '@/lib/links';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import { hostHref } from '../infrastructure/host';
import { AlertEventTable } from './AlertEventTable';
import { AlertStateIndicator, conditionText, formatAlertValue, signalLabel, THRESHOLD_UNITS, TYPE_LABELS } from './alerting';
import styles from './Monitors.module.scss';

type Pending = 'evaluate' | 'toggle' | 'delete' | 'save';

export function AlertMonitorDetailView({ id }: { id: string }) {
  const range = useTimeRange();
  const router = useRouter();
  const { data, error, isLoading, updatedAt, refetch } = useApi<AlertMonitorResponse>(`/alerting/monitors/${id}`);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const backHref = withRange('/monitors', range);
  const back = { href: backHref, label: 'Monitors' };
  const monitor = data?.monitor;

  if (error?.status === 404) {
    return (
      <>
        <PageHeader title="Monitor not found" back={back} />
        <EmptyState title="This monitor does not exist." description="It may have been deleted." action={<ButtonLink href={backHref}>Back to Monitors</ButtonLink>} />
      </>
    );
  }

  const perform = async (kind: Pending, action: () => Promise<void>) => {
    setPending(kind);
    setActionError(null);
    try {
      await action();
    } catch (failure) {
      setActionError(toApiClientError(failure).message);
    } finally {
      setPending(null);
    }
  };

  const evaluate = () =>
    perform('evaluate', async () => {
      await apiFetch(`/alerting/monitors/${id}/evaluate`, { method: 'POST' });
      refetch();
    });

  const toggle = (current: AlertMonitor) =>
    perform('toggle', async () => {
      await apiFetch(`/alerting/monitors/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !current.enabled }) });
      refetch();
    });

  const remove = () =>
    perform('delete', async () => {
      await apiFetch(`/alerting/monitors/${id}`, { method: 'DELETE' });
      router.push(backHref);
    });

  const tone = monitor?.state === 'critical' ? 'error' : monitor?.state === 'warning' ? 'warning' : undefined;

  return (
    <>
      <PageHeader
        back={back}
        title={monitor ? monitor.name : <Skeleton width="calc(var(--space-16) * 3)" height="var(--text-page)" />}
        status={
          monitor && (
            <>
              <AlertStateIndicator state={monitor.state} enabled={monitor.enabled} />
              <span className={styles.reason}>{monitor.stateMessage}</span>
            </>
          )
        }
        meta={monitor && <MonitorMeta monitor={monitor} range={range} />}
        actions={
          monitor &&
          (confirmingDelete ? (
            <>
              <span className={styles.confirm}>Delete this monitor and its history?</span>
              <Button size="sm" onClick={() => setConfirmingDelete(false)} disabled={pending === 'delete'}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" loading={pending === 'delete'} onClick={remove}>
                Delete monitor
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" loading={pending === 'evaluate'} disabled={pending !== null || !monitor.enabled} onClick={evaluate}>
                Evaluate now
              </Button>
              <Button size="sm" loading={pending === 'toggle'} disabled={pending !== null} onClick={() => toggle(monitor)}>
                {monitor.enabled ? 'Pause' : 'Resume'}
              </Button>
              <Button size="sm" variant="danger" disabled={pending !== null} onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            </>
          ))
        }
      />
      {actionError && (
        <Notice tone="error" title="Action failed.">
          {actionError}
        </Notice>
      )}
      <StaleNotice error={data ? error : undefined} updatedAt={updatedAt} onRetry={refetch} />

      {!data && !isLoading ? (
        <ErrorState title="Unable to load monitor." description={error?.message} onRetry={refetch} />
      ) : (
        <>
          <MetricGrid label="Monitor summary">
            <Metric
              label={monitor ? signalLabel(monitor) : 'Value'}
              loading={!monitor}
              value={monitor && formatAlertValue(monitor.type, monitor.stateValue)}
              tone={tone}
              meta={monitor && `last ${monitor.windowMinutes} min`}
            />
            <Metric
              label="Warning"
              loading={!monitor}
              value={monitor && formatAlertValue(monitor.type, monitor.warningThreshold)}
              meta={monitor?.warningThreshold === null ? 'not set' : 'threshold'}
            />
            <Metric label="Critical" loading={!monitor} value={monitor && formatAlertValue(monitor.type, monitor.criticalThreshold)} meta="threshold" />
            <Metric
              label="Last evaluated"
              loading={!monitor}
              value={monitor?.lastEvaluatedAt ? formatRelative(Date.parse(monitor.lastEvaluatedAt)) : '—'}
              meta={monitor && (monitor.enabled ? 'automatic' : 'paused')}
            />
          </MetricGrid>

          {monitor && <SignalSection monitor={monitor} range={range} />}

          <Section
            title={
              <>
                History {data && <span className={styles.count}>{data.events.length}</span>}
              </>
            }
            flush
          >
            {!data ? (
              <Skeleton height="calc(var(--row-height) * 3)" />
            ) : data.events.length > 0 ? (
              <AlertEventTable events={data.events} range={range} types={new Map([[id, data.monitor.type]])} showMonitor={false} />
            ) : (
              <EmptyState
                title="No state changes yet"
                description="The first evaluation runs within 30 seconds of creating the monitor."
                action={
                  <Button size="sm" onClick={evaluate} disabled={pending !== null}>
                    Evaluate now
                  </Button>
                }
              />
            )}
          </Section>

          {monitor && <SettingsSection key={monitor.updatedAt} monitor={monitor} onSaved={refetch} />}
        </>
      )}
    </>
  );
}

function MonitorMeta({ monitor, range }: { monitor: AlertMonitor; range: TimeRange }) {
  const targetHref = monitor.type === 'host_resource' ? hostHref(monitor.target, range) : serviceHref(monitor.target, range);
  return (
    <>
      <span>{TYPE_LABELS[monitor.type]}</span>
      <span className={styles.metaSeparator} aria-hidden>
        ·
      </span>
      <Link href={targetHref} className={`${styles.mono} ${styles.metaLink}`}>
        {monitor.target}
      </Link>
      <span className={styles.metaSeparator} aria-hidden>
        ·
      </span>
      <span className={styles.mono}>{conditionText(monitor)}</span>
    </>
  );
}

/** The monitored signal over the selected range, with the thresholds drawn in. */
function SignalSection({ monitor, range }: { monitor: AlertMonitor; range: TimeRange }) {
  const isHost = monitor.type === 'host_resource';
  const encoded = encodeURIComponent(monitor.target);
  const service = useApi<ServiceResponse>(isHost ? null : `/services/${encoded}?range=${range}`, 30_000);
  const host = useApi<HostResponse>(isHost ? `/hosts/${encoded}?range=${range}` : null, 30_000);
  const source = isHost ? host : service;

  const chart = useMemo(() => {
    let timestamps: number[] = [];
    let values: (number | null)[] = [];
    if (isHost && host.data) {
      const metric = monitor.metric ?? 'cpu';
      timestamps = host.data.series.points.map((point) => point.t);
      values = host.data.series.points.map((point) => (point[metric] === null ? null : point[metric] * 100));
    } else if (!isHost && service.data) {
      const points = service.data.series.points;
      timestamps = points.map((point) => point.t);
      values = points.map((point) =>
        monitor.type === 'latency'
          ? point.p95Ms
          : monitor.type === 'error_rate'
            ? point.requests > 0
              ? (point.errors / point.requests) * 100
              : null
            : point.requests,
      );
    }
    const constant = (value: number) => timestamps.map(() => value);
    const series: ChartSeries[] = [{ label: signalLabel(monitor), color: '--chart-primary', values }];
    // Service Down thresholds apply to the whole window, not to one bucket.
    if (monitor.type !== 'service_down') {
      if (monitor.warningThreshold !== null) {
        series.push({ label: 'Warning', color: '--status-warning', dashed: true, values: constant(monitor.warningThreshold) });
      }
      series.push({ label: 'Critical', color: '--status-error', dashed: true, values: constant(monitor.criticalThreshold) });
    }
    return { timestamps, series, hasData: values.some((value) => value !== null) };
  }, [host.data, isHost, monitor, service.data]);

  const format = useMemo(() => (value: number) => formatAlertValue(monitor.type, value), [monitor.type]);
  const formatAxis = useMemo(() => (value: number) => (value === 0 ? '0' : formatAlertValue(monitor.type, value)), [monitor.type]);

  return (
    <Section title={`${signalLabel(monitor)} · ${monitor.target}`} actions={chart.hasData ? <ChartLegend series={chart.series} /> : undefined}>
      {chart.hasData ? (
        <TimeSeriesChart
          key={`${monitor.type}|${monitor.warningThreshold}|${monitor.criticalThreshold}`}
          timestamps={chart.timestamps}
          series={chart.series}
          formatValue={format}
          formatAxis={formatAxis}
          ariaLabel={`${signalLabel(monitor)} of ${monitor.target} with alert thresholds.`}
        />
      ) : source.error && source.error.status !== 404 ? (
        <ErrorState fill="chart" title="Unable to load the signal." description={source.error.message} onRetry={source.refetch} />
      ) : source.data || source.error ? (
        <EmptyState
          fill="chart"
          title={`No data from ${monitor.target} in this range`}
          description="The monitor reports No data until the target sends telemetry."
          action={
            <Button size="sm" onClick={source.refetch}>
              Refresh
            </Button>
          }
        />
      ) : (
        <Skeleton height="var(--chart-height)" />
      )}
    </Section>
  );
}

function SettingsSection({ monitor, onSaved }: { monitor: AlertMonitor; onSaved: () => void }) {
  const [values, setValues] = useState({
    warningThreshold: monitor.warningThreshold === null ? '' : String(monitor.warningThreshold),
    criticalThreshold: String(monitor.criticalThreshold),
    windowMinutes: String(monitor.windowMinutes),
    webhookUrl: monitor.webhookUrl,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const unit = THRESHOLD_UNITS[monitor.type];

  const update = (name: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [name]: event.target.value }));
    setErrors((current) => ({ ...current, [name]: '' }));
    setSaved(false);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await apiFetch(`/alerting/monitors/${monitor.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          warningThreshold: values.warningThreshold.trim() === '' ? null : Number(values.warningThreshold),
          criticalThreshold: Number(values.criticalThreshold),
          windowMinutes: Number(values.windowMinutes),
          webhookUrl: values.webhookUrl.trim(),
        }),
      });
      setSaved(true);
      onSaved();
    } catch (failure) {
      const apiError = toApiClientError(failure);
      const next: Record<string, string> = {};
      for (const issue of apiError.validationIssues) next[issue.path] ??= issue.message;
      setErrors(Object.keys(next).length > 0 ? next : { form: apiError.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Settings">
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field id="edit-warning" label={`Warning (${unit})`} hint="Leave empty for no warning." error={errors.warningThreshold}>
          <Input id="edit-warning" value={values.warningThreshold} onChange={update('warningThreshold')} type="number" inputMode="decimal" mono min={0} invalid={Boolean(errors.warningThreshold)} />
        </Field>
        <Field id="edit-critical" label={`Critical (${unit})`} error={errors.criticalThreshold}>
          <Input id="edit-critical" value={values.criticalThreshold} onChange={update('criticalThreshold')} type="number" inputMode="decimal" mono min={0} invalid={Boolean(errors.criticalThreshold)} />
        </Field>
        <Field id="edit-window" label="Window" error={errors.windowMinutes}>
          <Select id="edit-window" value={values.windowMinutes} onChange={update('windowMinutes')}>
            {ALERT_WINDOWS_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                Last {minutes} min
              </option>
            ))}
          </Select>
        </Field>
        <Field id="edit-webhook" label="Webhook URL" hint="Optional." error={errors.webhookUrl}>
          <Input id="edit-webhook" value={values.webhookUrl} onChange={update('webhookUrl')} type="url" mono invalid={Boolean(errors.webhookUrl)} />
        </Field>
        <div className={styles.formActions}>
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
          {saved && <span className={styles.saved}>Saved.</span>}
          {errors.form && <span className={styles.error}>{errors.form}</span>}
        </div>
      </form>
    </Section>
  );
}
