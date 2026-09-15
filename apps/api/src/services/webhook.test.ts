import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { sendWebhook, testWebhookPayload, webhookFormat, webhookRequest, type WebhookPayload } from './webhook';

const critical: WebhookPayload = {
  text: '[CRITICAL] 결제 API: Error rate 12% ≥ 5%',
  monitor: { id: 'mon_1', name: '결제 API', type: 'error_rate', target: 'payment', targetLabel: 'payment' },
  state: 'critical',
  previousState: 'ok',
  value: 12,
  message: 'Error rate 12% ≥ 5%',
  timestamp: '2026-09-15T00:00:00.000Z',
};

test('recognises webhook services by URL', () => {
  assert.equal(webhookFormat('https://hooks.slack.com/services/T/B/X'), 'slack');
  assert.equal(webhookFormat('https://discord.com/api/webhooks/1/abc'), 'discord');
  assert.equal(webhookFormat('https://ptb.discordapp.com/api/webhooks/1/abc'), 'discord');
  assert.equal(webhookFormat('https://discord.com/api/v10/webhooks/1/abc'), 'discord');
  assert.equal(webhookFormat('https://discord.com/api/webhooks/1/abc/slack'), 'slack');
  assert.equal(webhookFormat('https://discord.com/api/webhooks/1/abc/github'), 'json');
  assert.equal(webhookFormat('https://discord.com/channels/1'), 'json');
  assert.equal(webhookFormat('https://api.telegram.org/bot123:abc/sendMessage?chat_id=42'), 'telegram');
  assert.equal(webhookFormat('https://ntfy.sh/my-alerts'), 'ntfy');
  assert.equal(webhookFormat('https://example.com/hook'), 'json');
  assert.equal(webhookFormat('https://evil-discord.com/api/webhooks/1'), 'json');
});

test('Discord gets content with mentions disabled', () => {
  const { headers, body } = webhookRequest('https://discord.com/api/webhooks/1/abc', critical);
  assert.equal(headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(body), { content: critical.text, username: 'minidog', allowed_mentions: { parse: [] } });
});

test('Telegram gets the chat id from the URL', () => {
  const { body } = webhookRequest('https://api.telegram.org/bot123:abc/sendMessage?chat_id=42', critical);
  assert.deepEqual(JSON.parse(body), { chat_id: '42', text: critical.text, disable_web_page_preview: true });
});

test('ntfy gets plain text with ASCII headers', () => {
  const { headers, body } = webhookRequest('https://ntfy.sh/my-alerts', critical);
  assert.equal(body, critical.text);
  assert.equal(headers.title, 'minidog critical');
  assert.equal(headers.priority, '5');
  assert.equal(headers.tags, 'rotating_light');
  assert.equal(webhookRequest('https://ntfy.sh/my-alerts', testWebhookPayload()).headers.title, 'minidog test');
});

test('other URLs get the JSON payload', () => {
  const { body } = webhookRequest('https://example.com/hook', critical);
  assert.deepEqual(JSON.parse(body), critical);
});

let received: { headers: IncomingHttpHeaders; body: string }[] = [];
let baseUrl = '';
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    received.push({ headers: req.headers, body });
    res.statusCode = req.url === '/fail' ? 500 : 204;
    res.end();
  });
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('sendWebhook reports the response status', async () => {
  received = [];
  assert.equal(await sendWebhook(`${baseUrl}/ok`, critical), 'sent 204');
  assert.equal(await sendWebhook(`${baseUrl}/fail`, critical), 'failed 500');
  assert.equal(received[0]?.headers['content-type'], 'application/json');
  assert.equal(JSON.parse(received[0]!.body).state, 'critical');
});
