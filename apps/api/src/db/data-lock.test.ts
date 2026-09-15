import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { acquireDataLock, DataLockedError, LOCK_STALE_MS } from './data-lock';

const dbPath = () => join(mkdtempSync(join(tmpdir(), 'minidog-lock-')), 'minidog.sqlite');

test('a second claim on the same data fails until the first is released', () => {
  const path = dbPath();
  const first = acquireDataLock(path);
  assert.throws(() => acquireDataLock(path), DataLockedError);
  first.release();
  assert.equal(existsSync(`${path}.lock`), false);
  acquireDataLock(path).release();
});

test('a lock left by a dead process on this machine is taken over', () => {
  const path = dbPath();
  // A pid that is not running.
  writeFileSync(`${path}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), startedAt: 'earlier' }));
  acquireDataLock(path).release();
});

test('a lock from another machine holds while refreshed and expires when not', () => {
  const path = dbPath();
  writeFileSync(`${path}.lock`, JSON.stringify({ pid: 1, host: 'minidog-container', startedAt: 'earlier' }));
  assert.throws(() => acquireDataLock(path), (error: unknown) => error instanceof DataLockedError && /minidog-container/.test(error.message));

  const old = new Date(Date.now() - LOCK_STALE_MS - 5_000);
  utimesSync(`${path}.lock`, old, old);
  acquireDataLock(path).release();
});
