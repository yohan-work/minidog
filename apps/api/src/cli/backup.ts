/**
 * Copies the metadata database — the password, API keys, projects, monitors,
 * dashboards and alert history — somewhere safe. Telemetry lives in ClickHouse
 * and is not included; it ages out anyway, while losing this file means setting
 * everything up again and re-keying every sender.
 *
 * Safe to run while minidog is running, as long as both see the same
 * filesystem: VACUUM INTO writes a consistent snapshot, which copying the file
 * by hand does not.
 *
 *   pnpm db:backup ./minidog-backup.sqlite
 *   docker compose exec api node cli/backup.mjs /data/minidog-backup.sqlite
 */
import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config';
import { readLockOwner } from '../db/data-lock';

try {
  process.loadEnvFile();
} catch {
  // .env is optional.
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: backup <file>   e.g. backup ./minidog-backup.sqlite');
  process.exit(1);
}

const config = loadConfig();
// pnpm runs this with apps/api as the working directory; INIT_CWD is where the
// person actually typed the command.
const destination = resolve(process.env.INIT_CWD ?? process.cwd(), target);
if (existsSync(destination)) {
  console.error(`${destination} already exists. Choose another name, or delete it first.`);
  process.exit(1);
}
if (!existsSync(config.SQLITE_PATH)) {
  console.error(`No database at ${config.SQLITE_PATH}. Set SQLITE_PATH to the data minidog uses.`);
  process.exit(1);
}

// SQLite's own locking cannot be trusted across a bind mount, which is how the
// always-on containers share this file with the host — the reason the data lock
// exists at all. A snapshot taken from the other side of that boundary can be
// torn, so say so rather than hand over a backup that looks fine.
const owner = readLockOwner(config.SQLITE_PATH);
if (owner && owner.host !== hostname()) {
  console.error(
    `minidog is running on ${owner.host}, and this is ${hostname()}: a snapshot taken from here may be incomplete.\n` +
      'Run the backup where minidog runs, e.g. docker compose exec api node cli/backup.mjs /data/minidog-backup.sqlite',
  );
  process.exit(1);
}

// Read-only, and waiting rather than failing on a busy database: a backup must
// never be the thing that changes the data. Opened directly instead of through
// openDatabase so it copies the schema it finds and never migrates it.
const db = new DatabaseSync(config.SQLITE_PATH, { readOnly: true });
try {
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
} finally {
  db.close();
}
console.log(`Copied ${config.SQLITE_PATH} to ${destination}. Restore it with: restore ${destination}`);
