/**
 * Puts a backup back in place of the metadata database.
 *
 * minidog must be stopped: the API keeps its own handle on the file, so a
 * restore underneath a running process would be overwritten or half-read. The
 * data lock is claimed here, which refuses while an API holds it.
 *
 *   pnpm db:restore ./minidog-backup.sqlite
 *   docker compose stop api
 *   docker compose run --rm api node cli/restore.mjs /data/minidog-backup.sqlite
 *   docker compose start api
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config';
import { acquireDataLock, DataLockedError } from '../db/data-lock';

try {
  process.loadEnvFile();
} catch {
  // .env is optional.
}

const source = process.argv[2];
if (!source) {
  console.error('Usage: restore <file>   e.g. restore ./minidog-backup.sqlite');
  process.exit(1);
}

const config = loadConfig();
const backup = resolve(source);
if (!existsSync(backup)) {
  console.error(`No file at ${backup}.`);
  process.exit(1);
}

// A truncated or unrelated file would otherwise replace working data.
try {
  const check = new DatabaseSync(backup, { readOnly: true });
  try {
    check.prepare('SELECT count(*) FROM sqlite_schema').get();
  } finally {
    check.close();
  }
} catch (error) {
  console.error(`${backup} is not a readable SQLite database: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

let lock: ReturnType<typeof acquireDataLock>;
try {
  lock = acquireDataLock(config.SQLITE_PATH);
} catch (error) {
  if (!(error instanceof DataLockedError)) throw error;
  console.error(`${error.message}\nStop minidog before restoring.`);
  process.exit(1);
}

try {
  mkdirSync(dirname(config.SQLITE_PATH), { recursive: true });
  copyFileSync(backup, config.SQLITE_PATH);
  // Journals belong to the file that was just replaced; leaving them would
  // reapply writes from the database that is now gone.
  rmSync(`${config.SQLITE_PATH}-wal`, { force: true });
  rmSync(`${config.SQLITE_PATH}-shm`, { force: true });
} finally {
  lock.release();
}
console.log(`Restored ${backup} to ${config.SQLITE_PATH}. Start minidog again.`);
