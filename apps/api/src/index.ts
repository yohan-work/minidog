import { createServer } from 'node:net';
import { buildApp } from './app';
import { loadConfig } from './config';

try {
  process.loadEnvFile();
} catch {
  // .env is optional; defaults match infra/docker/compose.yaml.
}

const config = loadConfig();

// Checked before the SQLite file is opened: a second API on the same data (pnpm dev
// while the always-on containers run, or the other way round) could corrupt it.
try {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen({ host: config.HOST, port: config.PORT }, () => probe.close(() => resolve()));
  });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
  console.error(
    `Port ${config.PORT} is already in use. If minidog is running in always-on mode, stop it first with \`pnpm local:down\`.`,
  );
  process.exit(1);
}

const app = await buildApp(config);

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

await app.listen({ host: config.HOST, port: config.PORT });
