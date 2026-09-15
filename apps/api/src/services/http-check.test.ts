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
    if (req.url === '/text') return res.end('Hello from minidog');
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/ok' });
      return res.end();
    }
    if (req.url === '/redirect-absolute') {
      res.writeHead(301, { location: `http://${req.headers.host}/text` });
      return res.end();
    }
    if (req.url === '/loop') {
      res.writeHead(302, { location: '/loop' });
      return res.end();
    }
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

test('without following, a redirect is judged as it is', async () => {
  const lenient = await performHttpCheck(target('/redirect'));
  assert.equal(lenient.status, 'up');
  assert.equal(lenient.statusCode, 302);
  assert.equal(lenient.redirects, 0);

  const strict = await performHttpCheck(target('/redirect', { expectedStatus: parseExpectedStatus('200')! }));
  assert.equal(strict.status, 'down');
});

test('following redirects judges the final response', async () => {
  const relative = await performHttpCheck(target('/redirect', { followRedirects: true, expectedStatus: parseExpectedStatus('200')! }));
  assert.equal(relative.status, 'up');
  assert.equal(relative.statusCode, 200);
  assert.equal(relative.redirects, 1);
  assert.equal(relative.finalUrl, `${baseUrl}/ok`);

  const absolute = await performHttpCheck(target('/redirect-absolute', { followRedirects: true }));
  assert.equal(absolute.finalUrl, `${baseUrl}/text`);
});

test('a redirect loop fails after five hops', async () => {
  const result = await performHttpCheck(target('/loop', { followRedirects: true }));
  assert.equal(result.status, 'down');
  assert.equal(result.redirects, 5);
  assert.equal(result.error, 'Too many redirects (more than 5)');
});

test('the body must contain the expected text', async () => {
  assert.equal((await performHttpCheck(target('/text', { bodyContains: 'from minidog' }))).status, 'up');

  const missing = await performHttpCheck(target('/text', { bodyContains: 'Welcome' }));
  assert.equal(missing.status, 'down');
  assert.equal(missing.statusCode, 200);
  assert.equal(missing.error, 'Response body does not contain "Welcome"');

  const afterRedirect = await performHttpCheck(target('/redirect', { followRedirects: true, bodyContains: 'ok' }));
  assert.equal(afterRedirect.status, 'up');
});
