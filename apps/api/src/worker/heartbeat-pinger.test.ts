import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { HeartbeatPinger } from './heartbeat-pinger';

let port = 0;
let hits = 0;
let status = 200;
const server = createServer((_req, res) => {
  hits += 1;
  res.statusCode = status;
  res.end('ok');
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

const warnings: unknown[] = [];
const log = { info: () => {}, warn: (details: unknown) => warnings.push(details) } as never;

test('a ping reaches the service that watches for silence', async () => {
  const before = hits;
  const pinger = new HeartbeatPinger(`http://127.0.0.1:${port}/ping`, 60_000, log);
  assert.equal(await pinger.ping(), 200);
  assert.equal(hits, before + 1);
});

test('a refused ping is reported, not thrown', async () => {
  status = 500;
  try {
    const pinger = new HeartbeatPinger(`http://127.0.0.1:${port}/ping`, 60_000, log);
    assert.equal(await pinger.ping(), 500);
    assert.equal(warnings.length, 1);
  } finally {
    status = 200;
  }
});

test('a heartbeat URL cannot be used to reach a metadata address', async () => {
  const pinger = new HeartbeatPinger('http://169.254.169.254/latest/meta-data', 60_000, log);
  // 0 means nothing was sent; the guard refused before the request.
  assert.equal(await pinger.ping(), 0);
  assert.equal(warnings.length, 2);
});
