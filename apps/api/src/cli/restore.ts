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
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config';
import { acquireDataLock, DataLockedError, LOCK_STALE_MS } from '../db/data-lock';
import { SCHEMA_VERSION } from '../db/sqlite';

try {
  process.loadEnvFile();
} catch {
  // .env is optional.
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: restore <file>   e.g. restore ./minidog-backup.sqlite');
  process.exit(1);
}

const config = loadConfig();
// pnpm runs this with apps/api as the working directory; INIT_CWD is where the
// person actually typed the command.
const backup = resolve(process.env.INIT_CWD ?? process.cwd(), target);
if (!existsSync(backup)) {
  console.error(`No file at ${backup}.`);
  process.exit(1);
}
check(backup);

const database = resolve(config.SQLITE_PATH);
mkdirSync(dirname(database), { recursive: true });

let lock: ReturnType<typeof acquireDataLock>;
try {
  lock = acquireDataLock(database);
} catch (error) {
  if (!(error instanceof DataLockedError)) throw error;
  console.error(
    `${error.message}\n` +
      `Stop minidog before restoring. If it is already stopped, it was not shut down cleanly: ` +
      `the lock expires ${LOCK_STALE_MS / 1000} s after it was last refreshed, so try again in a moment.`,
  );
  process.exit(1);
}

const staged = `${database}.restoring`;
const previous = `${database}.bak`;
try {
  // Staged beside the database so the swap below is a rename on one filesystem:
  // a copy straight onto the database would leave it truncated if this stops
  // halfway, with nothing to go back to.
  rmSync(staged, { force: true });
  copyFileSync(backup, staged);

  // The journals belong to the database being replaced. A -wal left next to the
  // restored file would be replayed into it, because nothing in a WAL says
  // which database it came from.
  if (existsSync(database)) {
    rmSync(previous, { force: true });
    rmSync(`${previous}-wal`, { force: true });
    rmSync(`${previous}-shm`, { force: true });
    renameSync(database, previous);
    moveIfPresent(`${database}-wal`, `${previous}-wal`);
    moveIfPresent(`${database}-shm`, `${previous}-shm`);
  }
  renameSync(staged, database);
} finally {
  rmSync(staged, { force: true });
  lock.release();
}

console.log(
  `Restored ${backup} to ${database}. ` +
    (existsSync(previous) ? `The database it replaced is at ${previous}. ` : '') +
    'Start minidog again.',
);

function moveIfPresent(from: string, to: string): void {
  if (existsSync(from)) renameSync(from, to);
}

/** Refuses anything that is not a minidog database, before it replaces one. */
function check(path: string): void {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    console.error(`${path} is not a readable SQLite database: ${message(error)}`);
    process.exit(1);
  }
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('settings', 'projects')")
      .all() as { name: string }[];
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (tables.length < 2 || version === 0) {
      console.error(`${path} is a SQLite database, but not one of minidog's. Nothing was changed.`);
      process.exit(1);
    }
    if (version > SCHEMA_VERSION) {
      console.error(
        `${path} was written by a newer minidog (schema ${version}; this build knows ${SCHEMA_VERSION}). ` +
          'Restore it with that version instead.',
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(`${path} could not be read: ${message(error)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
