import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ApiKeyInfo } from '@minidog/types';
import { createId } from '../lib/id';
import type { Scope } from './project-repository';

interface KeyRow {
  id: string;
  project_id: string;
  environment: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Keys are random, so a fast hash is enough; only the hash is stored. */
export const hashKey = (secret: string) => createHash('sha256').update(secret).digest('hex');

const PREFIX_LENGTH = 12;
/** `last_used_at` is written at most this often per key. */
const TOUCH_INTERVAL_MS = 60_000;

function toInfo(row: KeyRow): ApiKeyInfo {
  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export class ApiKeyRepository {
  private readonly touched = new Map<string, number>();

  constructor(private readonly db: DatabaseSync) {}

  create(scope: Scope, name: string): { apiKey: ApiKeyInfo; secret: string } {
    const secret = createId('mdg', 32);
    const id = createId('key');
    this.db
      .prepare(
        `INSERT INTO api_keys (id, project_id, environment, name, prefix, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, scope.projectId, scope.environment, name, secret.slice(0, PREFIX_LENGTH), hashKey(secret), new Date().toISOString());
    return { apiKey: this.get(id)!, secret };
  }

  get(id: string): ApiKeyInfo | undefined {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as KeyRow | undefined;
    return row ? toInfo(row) : undefined;
  }

  list(projectId: string): ApiKeyInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM api_keys WHERE project_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC')
      .all(projectId) as unknown as KeyRow[];
    return rows.map(toInfo);
  }

  /** Returns false when the key does not belong to the project or is already revoked. */
  revoke(projectId: string, id: string): boolean {
    const result = this.db
      .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), id, projectId);
    return Number(result.changes) > 0;
  }

  /** Scope of an active key, or null when unknown or revoked. */
  resolve(secret: string): Scope | null {
    const row = this.db
      .prepare('SELECT id, project_id, environment FROM api_keys WHERE hash = ? AND revoked_at IS NULL')
      .get(hashKey(secret)) as Pick<KeyRow, 'id' | 'project_id' | 'environment'> | undefined;
    if (!row) return null;

    const now = Date.now();
    if (now - (this.touched.get(row.id) ?? 0) > TOUCH_INTERVAL_MS) {
      this.touched.set(row.id, now);
      this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date(now).toISOString(), row.id);
    }
    return { projectId: row.project_id, environment: row.environment };
  }
}
