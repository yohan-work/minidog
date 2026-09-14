'use client';

import {
  ALERT_MONITOR_DEFAULTS,
  ALERT_MONITOR_TYPES,
  ALERT_WINDOWS_MINUTES,
  HOST_RESOURCE_METRICS,
  type AlertMonitor,
  type AlertMonitorType,
  type HostListResponse,
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
import { monitorHref, RESOURCE_LABELS, THRESHOLD_UNITS, TYPE_DESCRIPTIONS, TYPE_LABELS } from './alerting';
import styles from './Monitors.module.scss';

interface FormValues {
  type: AlertMonitorType;
  target: string;
  metric: string;
  warningThreshold: string;
  criticalThreshold: string;
  windowMinutes: string;
  webhookUrl: string;
  name: string;
}

type FieldName = keyof FormValues;

function isType(value: string | null): value is AlertMonitorType {
  return value !== null && (ALERT_MONITOR_TYPES as readonly string[]).includes(value);
}

function defaultsFor(type: AlertMonitorType): Pick<FormValues, 'warningThreshold' | 'criticalThreshold' | 'windowMinutes'> {
  const defaults = ALERT_MONITOR_DEFAULTS[type];
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
  const initialType: AlertMonitorType = isType(params.get('type')) ? (params.get('type') as AlertMonitorType) : 'latency';

  const [values, setValues] = useState<FormValues>({
    type: initialType,
    target: params.get('target') ?? '',
    metric: 'cpu',
    ...defaultsFor(initialType),
    webhookUrl: '',
    name: '',
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const backHref = withRange('/monitors', range);

  const services = useApi<ServiceListResponse>('/services?range=24h', 60_000);
  const hosts = useApi<HostListResponse>('/hosts?range=24h', 60_000);
  const isHost = values.type === 'host_resource';
  const targets = isHost ? (hosts.data?.hosts.map((host) => host.host) ?? []) : (services.data?.services.map((service) => service.service) ?? []);
  const unit = THRESHOLD_UNITS[values.type];

  const update = (name: FieldName) => (event: { target: { value: string } }) => {
    const value = event.target.value;
    setValues((current) =>
      name === 'type' && isType(value) ? { ...current, type: value, target: '', ...defaultsFor(value) } : { ...current, [name]: value },
    );
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const hints: Partial<Record<FieldName, string>> = {
    type: TYPE_DESCRIPTIONS[values.type],
    target: targets.length > 0 ? `${targets.length} ${isHost ? 'hosts' : 'services'} reported in the last 24 hours.` : `No ${isHost ? 'hosts' : 'services'} reported yet; type the name.`,
    warningThreshold: values.type === 'service_down' ? `Optional. Warn below this many requests.` : `Optional, in ${unit}.`,
    criticalThreshold: values.type === 'service_down' ? 'Critical below this many requests (1 = no requests at all).' : `In ${unit}.`,
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
          ...(isHost ? { metric: values.metric } : {}),
          warningThreshold: values.warningThreshold.trim() === '' ? null : Number(values.warningThreshold),
          criticalThreshold: Number(values.criticalThreshold),
          windowMinutes: Number(values.windowMinutes),
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

  return (
    <>
      <PageHeader title="New monitor" back={{ href: backHref, label: 'Monitors' }} />
      {formError && (
        <Notice tone="error" title="Unable to create monitor.">
          {formError}
        </Notice>
      )}
      <Section title="Condition">
        <form className={styles.form} onSubmit={onSubmit} noValidate>
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
          <Field id="target" label={isHost ? 'Host' : 'Service'} hint={hints.target} error={errors.target}>
            <Input {...control('target')} list="monitor-targets" mono autoComplete="off" required />
          </Field>
          <datalist id="monitor-targets">
            {targets.map((target) => (
              <option key={target} value={target} />
            ))}
          </datalist>
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
          ) : (
            <Field id="windowMinutes" label="Window" error={errors.windowMinutes}>
              <WindowSelect control={control('windowMinutes')} />
            </Field>
          )}
          <Field id="warningThreshold" label={`Warning (${unit})`} hint={hints.warningThreshold} error={errors.warningThreshold}>
            <Input {...control('warningThreshold')} type="number" inputMode="decimal" mono min={0} />
          </Field>
          <Field id="criticalThreshold" label={`Critical (${unit})`} hint={hints.criticalThreshold} error={errors.criticalThreshold}>
            <Input {...control('criticalThreshold')} type="number" inputMode="decimal" mono min={0} required />
          </Field>
          {isHost && (
            <Field id="windowMinutes" label="Window" error={errors.windowMinutes}>
              <WindowSelect control={control('windowMinutes')} />
            </Field>
          )}
          <div className={styles.full}>
            <Field id="webhookUrl" label="Webhook URL" hint={hints.webhookUrl} error={errors.webhookUrl}>
              <Input {...control('webhookUrl')} type="url" mono placeholder="https://hooks.example.com/…" />
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
        </form>
      </Section>
    </>
  );
}

function WindowSelect({ control }: { control: Record<string, unknown> & { value: string } }) {
  return (
    <Select {...control}>
      {ALERT_WINDOWS_MINUTES.map((minutes) => (
        <option key={minutes} value={minutes}>
          Last {minutes} min
        </option>
      ))}
    </Select>
  );
}
