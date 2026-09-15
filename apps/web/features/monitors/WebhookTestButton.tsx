'use client';

import type { WebhookFormat, WebhookTestResponse } from '@minidog/types';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import styles from './Monitors.module.scss';

const FORMAT_LABELS: Record<WebhookFormat, string> = {
  slack: 'Slack message',
  discord: 'Discord message',
  telegram: 'Telegram message',
  ntfy: 'ntfy push',
  json: 'JSON',
};

/** Sends a sample notification to the URL in the field, before or after saving. */
export function WebhookTestButton({ url }: { url: string }) {
  const [sending, setSending] = useState(false);
  // The result belongs to the URL it was sent to; editing the field hides it.
  const [result, setResult] = useState<{ url: string; text: string; ok: boolean } | null>(null);
  const target = url.trim();

  const send = async () => {
    setSending(true);
    try {
      const { format, status } = await apiFetch<WebhookTestResponse>('/alerting/webhook-test', {
        method: 'POST',
        body: JSON.stringify({ url: target }),
      });
      setResult({ url: target, text: `${FORMAT_LABELS[format]} · ${status}`, ok: status.startsWith('sent') });
    } catch (failure) {
      const apiError = toApiClientError(failure);
      setResult({ url: target, text: apiError.validationIssues[0]?.message ?? apiError.message, ok: false });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.webhookTest}>
      <Button type="button" size="sm" onClick={send} loading={sending} disabled={!target}>
        Send test
      </Button>
      {result?.url === target && (
        <span role="status" className={result.ok ? styles.saved : styles.error}>
          {result.text}
        </span>
      )}
    </div>
  );
}
