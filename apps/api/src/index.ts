import { buildApp } from './app';
import { loadConfig } from './config';

try {
  process.loadEnvFile();
} catch {
  // .env is optional; defaults match infra/docker/compose.yaml.
}

const config = loadConfig();
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
