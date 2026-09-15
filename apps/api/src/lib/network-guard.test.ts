import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { parseExpectedStatus } from '../services/expected-status';
import { performHttpCheck } from '../services/http-check';
import { sendWebhook, testWebhookPayload } from '../services/webhook';
import { blockedReason, networkPolicy } from './network-guard';

let port = 0;
const server = createServer((_req, res) => res.end('ok'));
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

const check = (url: string) =>
  performHttpCheck({ url, method: 'GET', timeoutMs: 3000, expectedStatus: parseExpectedStatus('200-399')! });

test('metadata, link-local and reserved addresses are always blocked', () => {
  for (const address of [
    '169.254.169.254',
    '0.0.0.0',
    '100.100.100.200',
    '255.255.255.255',
    'fe80::1',
    '[fd00:ec2::254]',
    '::ffff:169.254.169.254',
  ]) {
    assert.notEqual(blockedReason(address, false), null, address);
  }
  for (const address of ['8.8.8.8', '2606:4700::1111', 'example.com'])
    assert.equal(blockedReason(address, true), null, address);
});

test('private and loopback networks are blocked only when asked', () => {
  for (const address of ['10.1.2.3', '172.20.0.1', '192.168.1.10', '127.0.0.1', '::1', 'fd12::1', '100.64.0.1']) {
    assert.equal(blockedReason(address, false), null, address);
    assert.notEqual(blockedReason(address, true), null, address);
  }
});

test('a synthetic check never reaches the cloud metadata service', async () => {
  const result = await check('http://169.254.169.254/latest/meta-data/');
  assert.equal(result.status, 'down');
  assert.equal(result.statusCode, 0);
  assert.match(result.error, /^Blocked 169\.254\.169\.254: link-local/);
});

test('a webhook target that trickles bytes is cut off at the deadline', async () => {
  const trickle = createServer((req) => {
    req.socket.write('HTTP/1.1 200 OK\r\nX-Slow: ');
    const drip = setInterval(() => req.socket.write('a'), 50);
    req.socket.on('close', () => clearInterval(drip));
  });
  await new Promise<void>((resolve) => trickle.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    const status = await sendWebhook(
      `http://127.0.0.1:${(trickle.address() as AddressInfo).port}/hook`,
      testWebhookPayload(),
      300,
    );
    assert.equal(status, 'failed: timeout');
    assert.ok(Date.now() - started < 2000);
  } finally {
    trickle.closeAllConnections();
    trickle.close();
  }
});

test('webhooks are refused for blocked addresses', async () => {
  assert.match(
    await sendWebhook('http://169.254.169.254/hook', testWebhookPayload()),
    /^failed: Blocked 169\.254\.169\.254/,
  );
});

test('with BLOCK_PRIVATE_TARGETS, local names and addresses are refused after DNS too', async () => {
  assert.equal((await check(`http://127.0.0.1:${port}/`)).status, 'up');
  networkPolicy.blockPrivate = true;
  try {
    const literal = await check(`http://127.0.0.1:${port}/`);
    assert.match(literal.error, /^Blocked 127\.0\.0\.1: private or loopback/);
    const named = await check(`http://localhost:${port}/`);
    assert.equal(named.status, 'down');
    assert.match(named.error, /^Blocked localhost \((127\.0\.0\.1|::1)\)/);
    assert.match(
      await sendWebhook(`http://localhost:${port}/hook`, testWebhookPayload()),
      /^failed: Blocked localhost/,
    );
  } finally {
    networkPolicy.blockPrivate = false;
  }
});
