'use client';

import {
  ALERT_MONITOR_TYPES,
  alertDefaults,
  alertDirection,
  HOST_RESOURCE_METRICS,
  isSyntheticAlertMetric,
  SYNTHETIC_ALERT_METRICS,
  usesWindow,
  type AlertMetric,
  type AlertMonitor,
  type AlertMonitorType,
  type HostListResponse,
  type MonitorListResponse,
  type ServiceListResponse,
} from '@minidog/types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field, fieldDescription } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import { useTimeRange, withRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import {
  DelayOptions,
  monitorHref,
  RESOURCE_LABELS,
  SYNTHETIC_METRIC_DESCRIPTIONS,
  SYNTHETIC_METRIC_LABELS,
  thresholdUnit,
  TYPE_DESCRIPTIONS,
  TYPE_LABELS,
  WindowOptions,
} from './alerting';
import styles from './Monitors.module.scss';

interface FormValues {
  type: AlertMonitorType;
  target: string;
  metric: string;
  warningThreshold: string;
  criticalThreshold: string;
  windowMinutes: string;
  alertAfterMinutes: string;
  recoverAfterMinutes: string;
  webhookUrl: string;
  name: string;
}

type FieldName = keyof FormValues;

function isType(value: string | null): value is AlertMonitorType {
  return value !== null && (ALERT_MONITOR_TYPES as readonly string[]).includes(value);
}

function defaultMetric(type: AlertMonitorType): string {
  if (type === 'host_resource') return 'cpu';
  if (type === 'synthetic_check') return 'failure_rate';
  return '';
}

function defaultsFor(type: AlertMonitorType, metric: string): Pick<FormValues, 'warningThreshold' | 'criticalThreshold' | 'windowMinutes'> {
  const defaults = alertDefaults(type, (metric || null) as AlertMetric | null);
  return {
    warningThreshold: defaults.warning === null ? '' : String(defaults.warning),
    criticalThreshold: String(defaults.critical),
    windowMinutes: String(defaults.windowMinutes),
  };
}

export function NewAlertMonitorView() {
  const router = useRouter();
  const range = useTimeRange();
  const params = useSearchParams();
  const [values, setValues] = useState<FormValues>(() => {
    const requested = params.get('type');
    const type: AlertMonitorType = isType(requested) ? requested : 'latency';
    const metric = defaultMetric(type);
    return {
      type,
      target: params.get('target') ?? '',
      metric,
      ...defaultsFor(type, metric),
      alertAfterMinutes: '0',
      recoverAfterMinutes: '0',
      webhookUrl: '',
      name: '',
    };
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const backHref = withRange('/monitors', range);

  const isHost = values.type === 'host_resource';
  const isSynthetic = values.type === 'synthetic_check';
  const signal = { type: values.type, metric: (values.metric || null) as AlertMetric | null };
  const unit = thresholdUnit(signal);
  const below = alertDirection(signal.type, signal.metric) === 'below';
  const showWindow = usesWindow(signal.type, signal.metric);

  const services = useApi<ServiceListResponse>(!isHost && !isSynthetic ? '/services?range=24h' : null, 60_000);
  const hosts = useApi<HostListResponse>(isHost ? '/hosts?range=24h' : null, 60_000);
  const synthetics = useApi<MonitorListResponse>(isSynthetic ? '/monitors?range=1h' : null, 60_000);
  const targets = isHost ? (hosts.data?.hosts.map((host) => host.host) ?? []) : (services.data?.services.map((service) => service.service) ?? []);
  const checks = synthetics.data?.monitors ?? [];

  const update = (name: FieldName) => (event: { target: { value: string } }) => {
    const value = event.target.value;
    setValues((current) => {
      if (name === 'type' && isType(value)) {
        const metric = defaultMetric(value);
        return { ...current, type: value, target: '', metric, ...defaultsFor(value, metric) };
      }
      // Each synthetic signal has its own unit, so its thresholds start from its defaults.
      if (name === 'metric' && current.type === 'synthetic_check') return { ...current, metric: value, ...defaultsFor(current.type, value) };
      return { ...current, [name]: value };
    });
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const hints: Partial<Record<FieldName, string>> = {
    type: TYPE_DESCRIPTIONS[values.type],
    target: isSynthetic
      ? synthetics.data && checks.length === 0
        ? 'No synthetic monitors yet. Create one in Synthetics first.'
        : 'The URL check to watch.'
      : targets.length > 0
        ? `${targets.length} ${isHost ? 'hosts' : 'services'} reported in the last 24 hours.`
        : `No ${isHost ? 'hosts' : 'services'} reported yet; type the name.`,
    metric: isSynthetic && isSyntheticAlertMetric(values.metric) ? SYNTHETIC_METRIC_DESCRIPTIONS[values.metric] : undefined,
    warningThreshold:
      values.type === 'service_down'
        ? 'Optional. Warn below this many requests.'
        : below
          ? `Optional. Warn below this many ${unit}.`
          : `Optional, in ${unit}.`,
    criticalThreshold:
      values.type === 'service_down'
        ? 'Critical below this many requests (1 = no requests at all).'
        : below
          ? `Critical below this many ${unit}.`
          : `In ${unit}.`,
    alertAfterMinutes: 'Enter Warning or Critical only when the condition lasts this long.',
    recoverAfterMinutes: 'Report recovery only after it holds this long.',
    webhookUrl: 'Optional. State changes are POSTed as JSON (Slack-compatible "text").',
    name: 'Defaults to the signal and target.',
  };

  const control = (name: FieldName) => ({
    id: name,
    name,
    value: values[name],
    onChange: update(name),
    invalid: Boolean(errors[name]),
    'aria-describedby': fieldDescription(name, { hint: hints[name], error: errors[name] }),
  });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      const { monitor } = await apiFetch<{ monitor: AlertMonitor }>('/alerting/monitors', {
        method: 'POST',
        body: JSON.stringify({
          type: values.type,
          target: values.target.trim(),
          ...(isHost || isSynthetic ? { metric: values.metric } : {}),
          warningThreshold: values.warningThreshold.trim() === '' ? null : Number(values.warningThreshold),
          criticalThreshold: Number(values.criticalThreshold),
          windowMinutes: Number(values.windowMinutes),
          alertAfterMinutes: Number(values.alertAfterMinutes),
          recoverAfterMinutes: Number(values.recoverAfterMinutes),
          webhookUrl: values.webhookUrl.trim(),
          ...(values.name.trim() ? { name: values.name.trim() } : {}),
        }),
      });
      router.push(monitorHref(monitor.id, range));
    } catch (error) {
      const apiError = toApiClientError(error);
      const fieldErrors: Partial<Record<FieldName, string>> = {};
      for (const issue of apiError.validationIssues) {
        if (issue.path in values) fieldErrors[issue.path as FieldName] ??= issue.message;
      }
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else setFormError(apiError.message);
      setSubmitting(false);
    }
  };

  const windowField = (
    <Field id="windowMinutes" label="Window" error={errors.windowMinutes}>
      <Select {...control('windowMinutes')}>
        <WindowOptions />
      </Select>
    </Field>
  );

  return (
    <>
      <PageHeader title="New monitor" back={{ href: backHref, label: 'Monitors' }} />
      {formError && (
        <Notice tone="error" title="Unable to create monitor.">
          {formError}
        </Notice>
      )}
      <form onSubmit={onSubmit} noValidate>
        <Section title="Condition">
          <div className={styles.form}>
            <div className={styles.full}>
              <Field id="type" label="Type" hint={hints.type} error={errors.type}>
                <Select {...control('type')}>
                  {ALERT_MONITOR_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field id="target" label={isSynthetic ? 'Synthetic monitor' : isHost ? 'Host' : 'Service'} hint={hints.target} error={errors.target}>
              {isSynthetic ? (
                <Select {...control('target')} required>
                  <option value="">Choose a monitor</option>
                  {checks.map((check) => (
                    <option key={check.id} value={check.id}>
                      {check.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...control('target')} list="monitor-targets" mono autoComplete="off" required />
              )}
            </Field>
            {!isSynthetic && (
              <datalist id="monitor-targets">
                {targets.map((target) => (
                  <option key={target} value={target} />
                ))}
              </datalist>
            )}
            {isHost ? (
              <Field id="metric" label="Resource" error={errors.metric}>
                <Select {...control('metric')}>
                  {HOST_RESOURCE_METRICS.map((metric) => (
                    <option key={metric} value={metric}>
                      {RESOURCE_LABELS[metric]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : isSynthetic ? (
              <Field id="metric" label="Signal" hint={hints.metric} error={errors.metric}>
                <Select {...control('metric')}>
                  {SYNTHETIC_ALERT_METRICS.map((metric) => (
                    <option key={metric} value={metric}>
                      {SYNTHETIC_METRIC_LABELS[metric]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              windowField
            )}
            <Field id="warningThreshold" label={`Warning (${unit})`} hint={hints.warningThreshold} error={errors.warningThreshold}>
              <Input {...control('warningThreshold')} type="number" inputMode="decimal" mono min={0} />
            </Field>
            <Field id="criticalThreshold" label={`Critical (${unit})`} hint={hints.criticalThreshold} error={errors.criticalThreshold}>
              <Input {...control('criticalThreshold')} type="number" inputMode="decimal" mono min={0} required />
            </Field>
            {(isHost || isSynthetic) && showWindow && windowField}
          </div>
        </Section>

        <Section title="Notifications">
          <div className={styles.form}>
            <Field id="alertAfterMinutes" label="Alert after" hint={hints.alertAfterMinutes} error={errors.alertAfterMinutes}>
              <Select {...control('alertAfterMinutes')}>
                <DelayOptions />
              </Select>
            </Field>
            <Field id="recoverAfterMinutes" label="Recover after" hint={hints.recoverAfterMinutes} error={errors.recoverAfterMinutes}>
              <Select {...control('recoverAfterMinutes')}>
                <DelayOptions />
              </Select>
            </Field>
            <div className={styles.full}>
              <Field id="webhookUrl" label="Webhook URL" hint={hints.webhookUrl} error={errors.webhookUrl}>
                <Input {...control('webhookUrl')} type="url" mono placeholder="https://hooks.slack.com/services/…" />
              </Field>
            </div>
            <div className={styles.full}>
              <Field id="name" label="Name" hint={hints.name} error={errors.name}>
                <Input {...control('name')} maxLength={100} />
              </Field>
            </div>
            <div className={styles.formActions}>
              <Button type="submit" variant="primary" loading={submitting}>
                Create monitor
              </Button>
              <ButtonLink href={backHref} variant="ghost">
                Cancel
              </ButtonLink>
            </div>
          </div>
        </Section>
      </form>
    </>
  );
}
