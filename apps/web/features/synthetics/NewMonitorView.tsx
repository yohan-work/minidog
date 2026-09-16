'use client';

import {
  MONITOR_BODY_CONTAINS_MAX,
  MONITOR_DEFAULTS,
  MONITOR_INTERVALS_SECONDS,
  MONITOR_TIMEOUT_MS,
  SYNTHETIC_ALERT_DEFAULTS,
  type SyntheticMonitor,
} from '@minidog/types';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field, fieldDescription } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import { formatInterval } from '@/lib/format';
import { useTimeRange, withRange } from '@/lib/time-range';
import styles from './Synthetics.module.scss';

interface FormValues {
  url: string;
  name: string;
  method: string;
  intervalSeconds: string;
  timeoutMs: string;
  expectedStatus: string;
  bodyContains: string;
  webhookUrl: string;
}

type FieldName = keyof FormValues;

const INITIAL: FormValues = {
  url: '',
  name: '',
  method: MONITOR_DEFAULTS.method,
  intervalSeconds: String(MONITOR_DEFAULTS.intervalSeconds),
  timeoutMs: String(MONITOR_DEFAULTS.timeoutMs),
  expectedStatus: MONITOR_DEFAULTS.expectedStatus,
  bodyContains: MONITOR_DEFAULTS.bodyContains,
  webhookUrl: '',
};

const FAILURE_ALERT = SYNTHETIC_ALERT_DEFAULTS.failure_rate;

const HINTS: Partial<Record<FieldName, string>> = {
  url: 'http:// or https://.',
  name: 'Defaults to the host name.',
  timeoutMs: `${MONITOR_TIMEOUT_MS.min}–${MONITOR_TIMEOUT_MS.max} ms, shorter than the interval.`,
  expectedStatus: 'Codes or ranges, e.g. 200-299,301. With redirects followed, the final response is checked.',
  bodyContains: 'Optional. The check fails unless the body contains this text (case-sensitive, first 1 MB).',
  webhookUrl: 'Optional. Slack, Discord, Telegram or an ntfy topic. Empty means the alert only shows in minidog.',
};

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host || null;
  } catch {
    return null;
  }
}

export function NewMonitorView() {
  const router = useRouter();
  const range = useTimeRange();
  const [values, setValues] = useState<FormValues>(INITIAL);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [followRedirects, setFollowRedirects] = useState<boolean>(MONITOR_DEFAULTS.followRedirects);
  const [alertOnFailure, setAlertOnFailure] = useState(true);
  /** Set when the check exists but its alert failed, so the check is never created twice. */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const backHref = withRange('/synthetics', range);

  const update = (name: FieldName) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [name]: event.target.value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const control = (name: FieldName) => ({
    id: name,
    name,
    value: values[name],
    onChange: update(name),
    invalid: Boolean(errors[name]),
    'aria-describedby': fieldDescription(name, { hint: HINTS[name], error: errors[name] }),
  });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    let monitorId: string;
    try {
      const { monitor } = await apiFetch<{ monitor: SyntheticMonitor }>('/monitors', {
        method: 'POST',
        body: JSON.stringify({
          url: values.url.trim(),
          name: values.name.trim() || undefined,
          method: values.method,
          intervalSeconds: Number(values.intervalSeconds),
          timeoutMs: Number(values.timeoutMs),
          expectedStatus: values.expectedStatus.trim(),
          followRedirects,
          bodyContains: values.bodyContains.trim(),
        }),
      });
      monitorId = monitor.id;
    } catch (error) {
      const apiError = toApiClientError(error);
      const fieldErrors: Partial<Record<FieldName, string>> = {};
      for (const issue of apiError.validationIssues) {
        if (issue.path in INITIAL) fieldErrors[issue.path as FieldName] ??= issue.message;
      }
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else setFormError(apiError.message);
      setSubmitting(false);
      return;
    }

    if (alertOnFailure) {
      try {
        await apiFetch('/alerting/monitors', {
          method: 'POST',
          body: JSON.stringify({
            type: 'synthetic_check',
            target: monitorId,
            metric: 'failure_rate',
            warningThreshold: FAILURE_ALERT.warning,
            criticalThreshold: FAILURE_ALERT.critical,
            windowMinutes: FAILURE_ALERT.windowMinutes,
            webhookUrl: values.webhookUrl.trim(),
          }),
        });
      } catch (error) {
        // The check is already running; say so instead of letting a retry create a second one.
        setCreatedId(monitorId);
        setFormError(toApiClientError(error).message);
        setSubmitting(false);
        return;
      }
    }

    router.push(withRange(`/synthetics/${monitorId}`, range));
  };

  return (
    <>
      <PageHeader title="New monitor" back={{ href: backHref, label: 'Synthetics' }} />
      {formError &&
        (createdId ? (
          <Notice tone="warning" title="The check was created, but its alert was not.">
            {formError} The check is already running; add the alert from its page.
          </Notice>
        ) : (
          <Notice tone="error" title="Unable to create monitor.">
            {formError}
          </Notice>
        ))}
      <Section title="HTTP check">
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <div className={styles.full}>
            <Field id="url" label="URL" hint={HINTS.url} error={errors.url}>
              <Input {...control('url')} type="url" mono placeholder="https://example.com" autoFocus required />
            </Field>
          </div>
          <Field id="name" label="Name" hint={HINTS.name} error={errors.name}>
            <Input {...control('name')} placeholder={hostOf(values.url) ?? 'example.com'} maxLength={100} />
          </Field>
          <Field id="method" label="Method" error={errors.method}>
            <Select {...control('method')}>
              <option value="GET">GET</option>
              <option value="HEAD">HEAD</option>
            </Select>
          </Field>
          <Field id="intervalSeconds" label="Check every" error={errors.intervalSeconds}>
            <Select {...control('intervalSeconds')}>
              {MONITOR_INTERVALS_SECONDS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {formatInterval(seconds)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="timeoutMs" label="Timeout (ms)" hint={HINTS.timeoutMs} error={errors.timeoutMs}>
            <Input
              {...control('timeoutMs')}
              type="number"
              inputMode="numeric"
              mono
              min={MONITOR_TIMEOUT_MS.min}
              max={MONITOR_TIMEOUT_MS.max}
              step={500}
            />
          </Field>
          <div className={styles.full}>
            <Field
              id="expectedStatus"
              label="Expected status"
              hint={HINTS.expectedStatus}
              error={errors.expectedStatus}
            >
              <Input {...control('expectedStatus')} mono />
            </Field>
          </div>
          <div className={styles.full}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={followRedirects}
                onChange={(event) => setFollowRedirects(event.target.checked)}
              />
              <span>
                Follow redirects <span className={styles.checkboxHint}>up to 5; the final response is checked</span>
              </span>
            </label>
          </div>
          <div className={styles.full}>
            <Field
              id="bodyContains"
              label="Response must contain"
              hint={HINTS.bodyContains}
              error={errors.bodyContains}
            >
              <Input {...control('bodyContains')} maxLength={MONITOR_BODY_CONTAINS_MAX} placeholder="e.g. Welcome" />
            </Field>
          </div>
          <div className={styles.full}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={alertOnFailure}
                onChange={(event) => setAlertOnFailure(event.target.checked)}
              />
              <span>
                Alert me when this check fails{' '}
                <span className={styles.checkboxHint}>
                  critical once {FAILURE_ALERT.critical}% of the checks in {FAILURE_ALERT.windowMinutes} minutes fail
                </span>
              </span>
            </label>
          </div>
          {alertOnFailure && (
            <div className={styles.full}>
              <Field id="webhookUrl" label="Send alerts to" hint={HINTS.webhookUrl} error={errors.webhookUrl}>
                <Input {...control('webhookUrl')} type="url" mono placeholder="https://ntfy.sh/your-topic" />
              </Field>
            </div>
          )}
          <div className={styles.formActions}>
            {createdId ? (
              <ButtonLink href={withRange(`/synthetics/${createdId}`, range)} variant="primary">
                Go to the check
              </ButtonLink>
            ) : (
              <Button type="submit" variant="primary" loading={submitting}>
                Create monitor
              </Button>
            )}
            <ButtonLink href={backHref} variant="ghost">
              Cancel
            </ButtonLink>
          </div>
        </form>
      </Section>
    </>
  );
}
