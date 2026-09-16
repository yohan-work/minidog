import { z } from 'zod';

const booleanString = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

const configSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  SQLITE_PATH: z.string().min(1).default('./data/minidog.sqlite'),

  CLICKHOUSE_URL: z.url().default('http://127.0.0.1:8123'),
  CLICKHOUSE_USER: z.string().default('minidog'),
  CLICKHOUSE_PASSWORD: z.string().default('minidog'),
  CLICKHOUSE_DATABASE: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .default('minidog'),

  WORKER_ENABLED: booleanString.default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  // Synthetic checks and webhooks never reach link-local or cloud metadata addresses;
  // on a shared server, also keep them off private and loopback networks.
  BLOCK_PRIVATE_TARGETS: booleanString.default(false),

  // Evaluates alert monitors in the API process.
  ALERTS_ENABLED: booleanString.default(true),
  ALERT_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),

  // Dashboard sign-in. Only disable it on a machine nobody else can reach.
  AUTH_DISABLED: booleanString.default(false),

  // minidog cannot report its own downtime. With a URL set, it pings a service
  // that notices silence (healthchecks.io, an Uptime Kuma push URL) while it runs.
  HEARTBEAT_URL: z
    .url()
    .refine((value) => value.startsWith('http://') || value.startsWith('https://'), 'Use an http:// or https:// URL.')
    .optional(),
  HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

  // Ingestion. Without a required key, unauthenticated data goes to the default project.
  INGEST_REQUIRE_API_KEY: booleanString.default(false),
  /** Shown as connection info in Settings. */
  PUBLIC_API_URL: z.url().default('http://localhost:4000'),
  PUBLIC_COLLECTOR_URL: z.url().default('http://localhost:4318'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid configuration:\n${issues.join('\n')}`);
  }
  return parsed.data;
}
