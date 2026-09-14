import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const configSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  SQLITE_PATH: z.string().min(1).default('./data/minidog.sqlite'),

  CLICKHOUSE_URL: z.url().default('http://127.0.0.1:8123'),
  CLICKHOUSE_USER: z.string().default('minidog'),
  CLICKHOUSE_PASSWORD: z.string().default('minidog'),
  CLICKHOUSE_DATABASE: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('minidog'),

  WORKER_ENABLED: booleanString.default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
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
