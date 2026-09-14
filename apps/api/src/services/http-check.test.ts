import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { parseExpectedStatus } from './expected-status';
import { performHttpCheck, type HttpCheckTarget } from './http-check';

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') return res.end('ok');
    if (req.url === '/error') {
      res.statusCode = 500;
      return res.end('boom');
    }
    if (req.url === '/slow') {
      const timer = setTimeout(() => res.end('late'), 1_000);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  // Unspecified host listens dual-stack, so `localhost` resolves either way and exercises DNS timing.
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const target = (path: string, overrides: Partial<HttpCheckTarget> = {}): HttpCheckTarget => ({
  url: `${baseUrl}${path}`,
  method: 'GET',
  timeoutMs: 2_000,
  expectedStatus: parseExpectedStatus('200-399')!,
  ...overrides,
});

test('passes on an expected status and records timings', async () => {
  const result = await performHttpCheck(target('/ok'));
  assert.equal(result.status, 'up');
  assert.equal(result.statusCode, 200);
  assert.equal(result.error, '');
  assert.ok(result.latencyMs >= 0);
  assert.notEqual(result.dnsMs, null);
  assert.notEqual(result.connectMs, null);
  assert.notEqual(result.ttfbMs, null);
  assert.equal(result.tlsMs, null);
  assert.equal(result.sslExpiresAt, null);
});

test('fails on an unexpected status with a readable error', async () => {
  const result = await performHttpCheck(target('/error'));
  assert.equal(result.status, 'down');
  assert.equal(result.statusCode, 500);
  assert.equal(result.error, 'Expected status 200-399, got 500');
});

test('honours custom expected status', async () => {
  const result = await performHttpCheck(target('/missing', { expectedStatus: parseExpectedStatus('404')! }));
  assert.equal(result.status, 'up');
  assert.equal(result.statusCode, 404);
});

test('fails with a timeout', async () => {
  const result = await performHttpCheck(target('/slow', { timeoutMs: 150 }));
  assert.equal(result.status, 'down');
  assert.equal(result.error, 'Timed out after 150 ms');
  assert.ok(result.latencyMs >= 140);
});

test('fails when the connection is refused', async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const { port } = closed.address() as AddressInfo;
  await new Promise<void>((resolve) => closed.close(() => resolve()));

  const result = await performHttpCheck(target('', { url: `http://127.0.0.1:${port}/` }));
  assert.equal(result.status, 'down');
  assert.equal(result.statusCode, 0);
  assert.equal(result.error, 'Connection refused (ECONNREFUSED)');
  assert.equal(result.dnsMs, null);
});
