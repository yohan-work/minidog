import http from 'node:http';
import https from 'node:https';
import type { AlertEvent, AlertMonitor, WebhookFormat } from '@minidog/types';
import { checkHost, guardedLookup } from '../lib/network-guard';

const TIMEOUT_MS = 5_000;

export interface WebhookPayload {
  /** Plain summary; Slack-compatible incoming webhooks display it. */
  text: string;
  /** Null for a test notification. */
  monitor: Pick<AlertMonitor, 'id' | 'name' | 'type' | 'target' | 'targetLabel'> | null;
  state: AlertEvent['toState'];
  previousState: AlertEvent['fromState'];
  value: number | null;
  message: string;
  timestamp: string;
  /** Set when a notification held during a mute is delivered afterwards. */
  note?: string;
  /** Set on notifications sent with "Send test". */
  test?: true;
  /** Set on daily and weekly summaries. */
  summary?: true;
}

export function webhookPayload(monitor: AlertMonitor, event: AlertEvent, note?: string): WebhookPayload {
  const suffix = note ? ` (${note})` : '';
  return {
    text: `[${event.toState.toUpperCase()}] ${monitor.name}: ${event.message}${suffix}`,
    monitor: { id: monitor.id, name: monitor.name, type: monitor.type, target: monitor.target, targetLabel: monitor.targetLabel },
    state: event.toState,
    previousState: event.fromState,
    value: event.value,
    message: event.message,
    timestamp: event.createdAt,
    ...(note ? { note } : {}),
  };
}

export function testWebhookPayload(): WebhookPayload {
  return {
    text: '[TEST] minidog: notifications from your monitors will arrive here.',
    monitor: null,
    state: 'ok',
    previousState: 'ok',
    value: null,
    message: 'Test notification',
    timestamp: new Date().toISOString(),
    test: true,
  };
}

export function summaryPayload(text: string, days: 1 | 7): WebhookPayload {
  return {
    text,
    monitor: null,
    state: 'ok',
    previousState: 'ok',
    value: null,
    message: days === 7 ? 'Weekly summary' : 'Daily summary',
    timestamp: new Date().toISOString(),
    summary: true,
  };
}

/** Recognises services whose webhooks expect their own body; anything else gets the JSON payload. */
export function webhookFormat(url: string): WebhookFormat {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'json';
  }
  const host = parsed.hostname.toLowerCase();
  const within = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (host === 'hooks.slack.com') return 'slack';
  if (within('discord.com') || within('discordapp.com')) {
    // /api[/v10]/webhooks/<id>/<token>; the /slack variant takes the Slack-style body.
    const match = /^\/api(?:\/v\d+)?\/webhooks\/[^/]+\/[^/]+(\/slack|\/github)?\/?$/.exec(parsed.pathname);
    if (match) return match[1] === '/slack' ? 'slack' : match[1] ? 'json' : 'discord';
  }
  if (host === 'api.telegram.org' && /^\/bot[^/]+\/sendMessage$/.test(parsed.pathname)) return 'telegram';
  if (host === 'ntfy.sh') return 'ntfy';
  return 'json';
}

/** ntfy push priority (1–5) and emoji tags per state. */
const NTFY_STYLES: Record<string, { priority: string; tags: string }> = {
  critical: { priority: '5', tags: 'rotating_light' },
  warning: { priority: '4', tags: 'warning' },
  ok: { priority: '3', tags: 'white_check_mark' },
};
const NTFY_DEFAULT = { priority: '3', tags: 'bell' };
const NTFY_SUMMARY = { priority: '3', tags: 'bar_chart' };

export function webhookRequest(url: string, payload: WebhookPayload): { headers: Record<string, string>; body: string } {
  const json = (body: unknown) => ({
    headers: { 'content-type': 'application/json', 'user-agent': 'minidog-alerts' },
    body: JSON.stringify(body),
  });
  switch (webhookFormat(url)) {
    case 'discord':
      // Discord rejects a body without `content`; mentions in monitor names stay inert.
      return json({ content: payload.text.slice(0, 2000), username: 'minidog', allowed_mentions: { parse: [] } });
    case 'telegram':
      return json({
        chat_id: new URL(url).searchParams.get('chat_id') ?? undefined,
        text: payload.text.slice(0, 4096),
        disable_web_page_preview: true,
      });
    case 'ntfy': {
      const style = payload.test ? NTFY_DEFAULT : payload.summary ? NTFY_SUMMARY : (NTFY_STYLES[payload.state] ?? NTFY_DEFAULT);
      return {
        // Header values must be ASCII, so monitor names (which may not be) stay in the body.
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'user-agent': 'minidog-alerts',
          title: payload.test ? 'minidog test' : payload.summary ? 'minidog summary' : `minidog ${payload.state}`,
          priority: style.priority,
          tags: style.tags,
        },
        body: payload.text,
      };
    }
    default:
      return json(payload);
  }
}

/** POSTs the payload; resolves to a short status such as `sent 200` or `failed: timeout`. Never throws. */
export async function sendWebhook(url: string, payload: WebhookPayload, timeoutMs: number = TIMEOUT_MS): Promise<string> {
  try {
    const { headers, body } = webhookRequest(url, payload);
    const status = await post(new URL(url), headers, body, timeoutMs);
    return status >= 200 && status < 300 ? `sent ${status}` : `failed ${status}`;
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : error instanceof Error ? error.message : 'error';
    return `failed: ${reason}`;
  }
}

/**
 * One POST over a connection that refuses blocked addresses; redirects are
 * not followed. `timeoutMs` bounds the whole request, not just silences, so a
 * target that trickles bytes cannot hold it open.
 */
function post(url: URL, headers: Record<string, string>, body: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(new Error(`Unsupported protocol ${url.protocol}`));
    const blocked = checkHost(url.hostname);
    if (blocked) return reject(blocked);
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      { method: 'POST', headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) }, lookup: guardedLookup },
      (response) => {
        clearTimeout(deadline);
        resolve(response.statusCode ?? 0);
        // Only the status matters; the body is not read.
        response.destroy();
      },
    );
    const deadline = setTimeout(() => {
      const error = new Error('timeout');
      error.name = 'TimeoutError';
      request.destroy(error);
    }, timeoutMs);
    request.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    request.end(body);
  });
}
