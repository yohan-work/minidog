import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { openDatabase } from '../db/sqlite';
import { AuthRepository } from '../repositories/auth-repository';

const commands = ['backup', 'restore', 'reset-password'] as const;
type Command = (typeof commands)[number];

function run(command: Command, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--import',
      import.meta.resolve('tsx'),
      fileURLToPath(new URL(`./${command}.ts`, import.meta.url)),
      ...args,
    ],
    {
      cwd,
      env: { PATH: process.env.PATH, SQLITE_PATH: join(cwd, 'data', 'minidog.sqlite'), ...env },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
}

for (const command of commands) {
  for (const flag of ['--help', '-h']) {
    test(`${command} ${flag} works without valid configuration or filesystem changes`, (t) => {
      const dir = mkdtempSync(join(tmpdir(), 'minidog-cli-help-'));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      for (const env of [{}, { PORT: 'invalid' }]) {
        for (const args of [[flag], ['unused.sqlite', flag]]) {
          const result = run(command, args, dir, env);
          assert.ifError(result.error);
          assert.equal(result.status, 0, result.stderr);
          assert.match(result.stdout, new RegExp(`Usage: ${command}`));
          assert.match(result.stdout, /pnpm /);
          assert.match(result.stdout, /docker compose /);
          assert.equal(result.stderr, '');
          assert.deepEqual(readdirSync(dir), []);
        }
      }
    });
  }
}

test('reset-password help preserves the password and sessions; normal invocation still clears them', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'minidog-cli-auth-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'minidog.sqlite');
  const db = openDatabase(path);
  t.after(() => db.close());
  const auth = new AuthRepository(db);
  auth.setPasswordHash('test-password-hash');
  const expiry = '2099-01-01T00:00:00.000Z';
  auth.createSession('test-session-hash', expiry);

  for (const flag of ['--help', '-h']) {
    const result = run('reset-password', [flag], dir, { SQLITE_PATH: path });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(auth.passwordHash(), 'test-password-hash');
    assert.equal(auth.sessionExpiry('test-session-hash'), expiry);
  }

  const result = run('reset-password', [], dir, { SQLITE_PATH: path });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Password cleared/);
  assert.equal(auth.passwordHash(), null);
  assert.equal(auth.sessionExpiry('test-session-hash'), undefined);
});

for (const command of ['backup', 'restore'] as const) {
  test(`${command} still rejects a missing file argument`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'minidog-cli-missing-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const result = run(command, [], dir);
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Usage: ${command} <file>`));
    assert.deepEqual(readdirSync(dir), []);
  });
}
