'use client';

import { MONITOR_BODY_CONTAINS_MAX, type MonitorWithSummary } from '@minidog/types';
import { useState, type FormEvent } from 'react';
import { Section } from '@/components/layout/Section';
import { Button } from '@/components/ui/Button';
import { Field, fieldDescription } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import styles from './Synthetics.module.scss';

/** What a check accepts as passing; saved changes apply from the next check. */
export function CheckSettings({ monitor, onSaved }: { monitor: MonitorWithSummary; onSaved: () => void }) {
  const [followRedirects, setFollowRedirects] = useState(monitor.followRedirects);
  const [bodyContains, setBodyContains] = useState(monitor.bodyContains);
  const [expectedStatus, setExpectedStatus] = useState(monitor.expectedStatus);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const bodyHint = monitor.method === 'HEAD' ? 'Needs GET: HEAD responses have no body.' : 'Optional. Case-sensitive, in the first 1 MB.';

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setSaved(false);
    try {
      await apiFetch(`/monitors/${monitor.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ followRedirects, bodyContains: bodyContains.trim(), expectedStatus: expectedStatus.trim() }),
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
    <Section title="Check settings">
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.full}>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={followRedirects} onChange={(event) => setFollowRedirects(event.target.checked)} />
            <span>
              Follow redirects <span className={styles.checkboxHint}>up to 5; the final response is checked</span>
            </span>
          </label>
        </div>
        <Field id="settings-body" label="Response must contain" hint={bodyHint} error={errors.bodyContains}>
          <Input
            id="settings-body"
            value={bodyContains}
            onChange={(event) => setBodyContains(event.target.value)}
            maxLength={MONITOR_BODY_CONTAINS_MAX}
            invalid={Boolean(errors.bodyContains)}
            aria-describedby={fieldDescription('settings-body', { hint: bodyHint, error: errors.bodyContains })}
          />
        </Field>
        <Field id="settings-status" label="Expected status" hint="Codes or ranges, e.g. 200-299,301." error={errors.expectedStatus}>
          <Input
            id="settings-status"
            value={expectedStatus}
            onChange={(event) => setExpectedStatus(event.target.value)}
            mono
            invalid={Boolean(errors.expectedStatus)}
          />
        </Field>
        <div className={styles.formActions}>
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
          {saved && <span className={styles.reason}>Saved; applies from the next check.</span>}
          {errors.form && <span className={styles.reason}>{errors.form}</span>}
        </div>
      </form>
    </Section>
  );
}
