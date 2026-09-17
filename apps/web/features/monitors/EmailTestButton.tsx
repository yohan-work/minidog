'use client';

import type { EmailTestResponse } from '@minidog/types';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import styles from './Monitors.module.scss';

/** Sends a sample email through the configured SMTP, before or after saving. */
export function EmailTestButton({ to, enabled }: { to: string; enabled: boolean }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ to: string; text: string; ok: boolean } | null>(null);
  const target = to.trim();

  const send = async () => {
    setSending(true);
    try {
      const { status } = await apiFetch<EmailTestResponse>('/alerting/email-test', {
        method: 'POST',
        body: JSON.stringify({ to: target }),
      });
      setResult({ to: target, text: status, ok: status.startsWith('sent') });
    } catch (failure) {
      const apiError = toApiClientError(failure);
      setResult({ to: target, text: apiError.validationIssues[0]?.message ?? apiError.message, ok: false });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.webhookTest}>
      <Button type="button" size="sm" onClick={send} loading={sending} disabled={!target || !enabled}>
        Send test
      </Button>
      {result?.to === target && (
        <span role="status" className={result.ok ? styles.saved : styles.error}>
          {result.text}
        </span>
      )}
    </div>
  );
}
