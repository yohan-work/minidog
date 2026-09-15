import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClickHouseClient } from '@clickhouse/client';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { openDatabase } from '../db/sqlite';
import { hashPassword, verifyPassword } from '../services/auth';

const DASHBOARD = { 'x-minidog-request': '1', 'content-type': 'application/json' };

// Auth needs no telemetry; ClickHouse calls fail as if it were down.
const offlineClickHouse = {
  command: async () => undefined,
  close: async () => undefined,
  query: async () => {
    throw new Error('offline');
  },
  insert: async () => undefined,
} as unknown as ClickHouseClient;

async function start(env: Record<string, string> = {}) {
  const config = loadConfig({ SQLITE_PATH: ':memory:', WORKER_ENABLED: 'false', ALERTS_ENABLED: 'false', LOG_LEVEL: 'silent', ...env });
  const app = await buildApp(config, { sqlite: openDatabase(':memory:'), clickhouse: offlineClickHouse });
  return app;
}

const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0]!;

test('passwords are hashed with a salt and verified', async () => {
  const hash = await hashPassword('correct horse');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(hash, await hashPassword('correct horse'));
  assert.equal(await verifyPassword(hash, 'correct horse'), true);
  assert.equal(await verifyPassword(hash, 'wrong horse'), false);
});

test('the Query API needs a password set on first run and a session afterwards', async () => {
  const app = await start();
  try {
    assert.equal((await app.inject({ url: '/api/dashboards' })).statusCode, 401);
    assert.deepEqual((await app.inject({ url: '/api/auth/status' })).json(), { enabled: true, setupRequired: true, signedIn: false });

    const tooShort = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: DASHBOARD, payload: { password: 'short' } });
    assert.equal(tooShort.statusCode, 400);

    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: DASHBOARD, payload: { password: 'correct horse' } });
    assert.equal(setup.statusCode, 204);
    assert.match(String(setup.headers['set-cookie']), /minidog_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000/);
    const cookie = cookieOf(setup);

    assert.equal((await app.inject({ url: '/api/dashboards', headers: { cookie } })).statusCode, 200);
    const again = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: DASHBOARD, payload: { password: 'another one' } });
    assert.equal(again.statusCode, 409);

    // A change without the dashboard's header is refused even when signed in.
    const forged = await app.inject({ method: 'POST', url: '/api/dashboards', headers: { cookie, 'content-type': 'application/json' }, payload: { name: 'x' } });
    assert.equal(forged.statusCode, 403);
    const created = await app.inject({ method: 'POST', url: '/api/dashboards', headers: { ...DASHBOARD, cookie }, payload: { name: 'Mine' } });
    assert.equal(created.statusCode, 201);

    // As the dashboard sends it: no body, so no content type.
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { 'x-minidog-request': '1', cookie } });
    assert.equal(logout.statusCode, 204);
    assert.equal((await app.inject({ url: '/api/dashboards', headers: { cookie } })).statusCode, 401);

    // Percent-encoding the path does not get around the guard.
    assert.equal((await app.inject({ url: '/%61pi/dashboards' })).statusCode, 401);
    const encoded = await app.inject({ method: 'POST', url: '/%61pi/dashboards', headers: { 'content-type': 'application/json' }, payload: { name: 'x' } });
    assert.equal(encoded.statusCode, 403);

    // A malformed cookie reads as signed out instead of breaking every call.
    const garbled = await app.inject({ url: '/api/auth/status', headers: { cookie: 'minidog_session=%E0' } });
    assert.equal(garbled.statusCode, 200);
    assert.equal(garbled.json().signedIn, false);
    assert.equal((await app.inject({ url: '/api/dashboards', headers: { cookie: 'minidog_session=%E0' } })).statusCode, 401);

    // Health stays public for probes; ingest is not behind the session.
    assert.notEqual((await app.inject({ url: '/api/health' })).statusCode, 401);
  } finally {
    await app.close();
  }
});

test('wrong passwords slow sign-in down without locking the owner out', async () => {
  const app = await start();
  try {
    await app.inject({ method: 'POST', url: '/api/auth/setup', headers: DASHBOARD, payload: { password: 'correct horse' } });
    // A parallel burst is handled one at a time, so it cannot outrun the count.
    const burst = await Promise.all(
      Array.from({ length: 6 }, () => app.inject({ method: 'POST', url: '/api/auth/login', headers: DASHBOARD, payload: { password: 'nope nope' } })),
    );
    assert.deepEqual(burst.map((response) => response.statusCode), [401, 401, 401, 401, 401, 401]);

    const started = Date.now();
    const owner = await app.inject({ method: 'POST', url: '/api/auth/login', headers: DASHBOARD, payload: { password: 'correct horse' } });
    assert.equal(owner.statusCode, 204);
    assert.ok(Date.now() - started >= 450, 'waits after repeated failures');

    const fast = Date.now();
    await app.inject({ method: 'POST', url: '/api/auth/login', headers: DASHBOARD, payload: { password: 'correct horse' } });
    assert.ok(Date.now() - fast < 400, 'a success clears the delay');
  } finally {
    await app.close();
  }
});

test('two first-run setups cannot both set the password', async () => {
  const app = await start();
  try {
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/auth/setup', headers: DASHBOARD, payload: { password: 'owner password' } }),
      app.inject({ method: 'POST', url: '/api/auth/setup', headers: DASHBOARD, payload: { password: 'someone else' } }),
    ]);
    assert.deepEqual([first.statusCode, second.statusCode], [204, 409]);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: DASHBOARD, payload: { password: 'owner password' } });
    assert.equal(login.statusCode, 204);
  } finally {
    await app.close();
  }
});

test('changing the password signs out other sessions', async () => {
  const app = await start();
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: DASHBOARD, payload: { password: 'correct horse' } });
    const first = cookieOf(setup);
    const other = cookieOf(await app.inject({ method: 'POST', url: '/api/auth/login', headers: DASHBOARD, payload: { password: 'correct horse' } }));

    const wrongCurrent = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { ...DASHBOARD, cookie: first }, payload: { current: 'nope', next: 'battery staple' } });
    assert.equal(wrongCurrent.statusCode, 401);
    const changed = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { ...DASHBOARD, cookie: first }, payload: { current: 'correct horse', next: 'battery staple' } });
    assert.equal(changed.statusCode, 204);

    assert.equal((await app.inject({ url: '/api/dashboards', headers: { cookie: first } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/dashboards', headers: { cookie: other } })).statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: DASHBOARD, payload: { password: 'battery staple' } });
    assert.equal(login.statusCode, 204);
  } finally {
    await app.close();
  }
});

test('AUTH_DISABLED opens the Query API but still needs the dashboard header for changes', async () => {
  const app = await start({ AUTH_DISABLED: 'true' });
  try {
    assert.equal((await app.inject({ url: '/api/dashboards' })).statusCode, 200);
    assert.deepEqual((await app.inject({ url: '/api/auth/status' })).json(), { enabled: false, setupRequired: false, signedIn: true });
    assert.equal((await app.inject({ method: 'POST', url: '/api/dashboards', headers: { 'content-type': 'application/json' }, payload: { name: 'x' } })).statusCode, 403);
  } finally {
    await app.close();
  }
});
