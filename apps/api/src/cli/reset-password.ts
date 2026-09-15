/**
 * Forgot the password? Clears it and signs everyone out; the next visit to the
 * dashboard sets a new one. Needs access to the data directory, so only the
 * machine's owner can run it:
 *
 *   pnpm auth:reset                                   (pnpm dev)
 *   docker compose -f infra/docker/compose.yaml exec api node cli/reset-password.mjs
 */
import { loadConfig } from '../config';
import { openDatabase } from '../db/sqlite';
import { AuthRepository } from '../repositories/auth-repository';

try {
  process.loadEnvFile();
} catch {
  // .env is optional.
}

const config = loadConfig();
const db = openDatabase(config.SQLITE_PATH);
new AuthRepository(db).reset();
db.close();
console.log('Password cleared and every session signed out. Open the dashboard to set a new password.');
