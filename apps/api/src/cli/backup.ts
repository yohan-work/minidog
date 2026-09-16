/**
 * Copies the metadata database — the password, API keys, projects, monitors,
 * dashboards and alert history — somewhere safe. Telemetry lives in ClickHouse
 * and is not included; it ages out anyway, while losing this file means setting
 * everything up again and re-keying every sender.
 *
 * Safe to run while minidog is running: VACUUM INTO writes a consistent
 * snapshot of a WAL database, which copying the file by hand does not.
 *
 *   pnpm db:backup ./minidog-backup.sqlite
 *   docker compose exec api node cli/backup.mjs /data/minidog-backup.sqlite
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config';

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
const destination = resolve(target);
if (existsSync(destination)) {
  console.error(`${destination} already exists. Choose another name, or delete it first.`);
  process.exit(1);
}
if (!existsSync(config.SQLITE_PATH)) {
  console.error(`No database at ${config.SQLITE_PATH}. Set SQLITE_PATH to the data minidog uses.`);
  process.exit(1);
}

// Opened directly rather than through openDatabase: a backup should copy the
// schema it finds, never migrate it.
const db = new DatabaseSync(config.SQLITE_PATH);
try {
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
} finally {
  db.close();
}
console.log(`Copied ${config.SQLITE_PATH} to ${destination}. Restore it with: restore ${destination}`);
