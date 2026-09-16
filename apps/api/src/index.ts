import { buildApp } from './app';
import { loadConfig } from './config';
import { acquireDataLock, DataLockedError } from './db/data-lock';

try {
  process.loadEnvFile();
} catch {
  // .env is optional; defaults match infra/docker/compose.yaml.
}

const config = loadConfig();

// Claimed before the SQLite file is opened: a second API on the same data (pnpm dev
// while the always-on containers run, or the other way round) could corrupt it.
let lock: ReturnType<typeof acquireDataLock>;
try {
  lock = acquireDataLock(config.SQLITE_PATH);
} catch (error) {
  if (!(error instanceof DataLockedError)) throw error;
  console.error(error.message);
  process.exit(1);
}

/** Says why, and lets go of the lock so the next start is not refused for 30 s. */
function giveUp(error: unknown): never {
  console.error('minidog could not start:', error);
  lock.release();
  process.exit(1);
}

let app: Awaited<ReturnType<typeof buildApp>>;
try {
  app = await buildApp(config);
} catch (error) {
  giveUp(error);
}
app.addHook('onClose', async () => lock.release());

let closing = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  process.exit(0);
}

process.once('SIGINT', (signal) => void shutdown(signal));
process.once('SIGTERM', (signal) => void shutdown(signal));

// The workers start from the onReady hook, so their failures land here too.
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  giveUp(error);
}
