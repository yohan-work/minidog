import type { AlertEvent, AlertMonitor } from '@minidog/types';

const TIMEOUT_MS = 5_000;

export interface WebhookPayload {
  /** Plain summary; Slack-compatible incoming webhooks display it. */
  text: string;
  monitor: Pick<AlertMonitor, 'id' | 'name' | 'type' | 'target'>;
  state: AlertEvent['toState'];
  previousState: AlertEvent['fromState'];
  value: number | null;
  message: string;
  timestamp: string;
}

export function webhookPayload(monitor: AlertMonitor, event: AlertEvent): WebhookPayload {
  return {
    text: `[${event.toState.toUpperCase()}] ${monitor.name}: ${event.message}`,
    monitor: { id: monitor.id, name: monitor.name, type: monitor.type, target: monitor.target },
    state: event.toState,
    previousState: event.fromState,
    value: event.value,
    message: event.message,
    timestamp: event.createdAt,
  };
}

/** POSTs the payload; resolves to a short status such as `sent 200` or `failed: timeout`. Never throws. */
export async function sendWebhook(url: string, payload: WebhookPayload): Promise<string> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'minidog-alerts' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok ? `sent ${response.status}` : `failed ${response.status}`;
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : error instanceof Error ? error.message : 'error';
    return `failed: ${reason}`;
  }
}
