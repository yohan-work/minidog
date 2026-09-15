import type { DatabaseSync } from 'node:sqlite';
import type { HttpMethod, SyntheticMonitor } from '@minidog/types';
import { createId } from '../lib/id';
import type { Scope } from './project-repository';

interface MonitorRow {
  id: string;
  project_id: string;
  environment: string;
  name: string;
  url: string;
  method: string;
  interval_seconds: number;
  timeout_ms: number;
  expected_status: string;
  follow_redirects: number;
  body_contains: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface NewMonitor {
  name: string;
  url: string;
  method: HttpMethod;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: string;
  followRedirects?: boolean;
  bodyContains?: string;
}

export type MonitorPatch = Partial<NewMonitor & { enabled: boolean }>;

const COLUMNS: Record<keyof MonitorPatch, string> = {
  name: 'name',
  url: 'url',
  method: 'method',
  intervalSeconds: 'interval_seconds',
  timeoutMs: 'timeout_ms',
  expectedStatus: 'expected_status',
  followRedirects: 'follow_redirects',
  bodyContains: 'body_contains',
  enabled: 'enabled',
};

function toMonitor(row: MonitorRow): SyntheticMonitor {
  return {
    id: row.id,
    projectId: row.project_id,
    environment: row.environment,
    name: row.name,
    url: row.url,
    method: row.method as HttpMethod,
    intervalSeconds: row.interval_seconds,
    timeoutMs: row.timeout_ms,
    expectedStatus: row.expected_status,
    followRedirects: row.follow_redirects === 1,
    bodyContains: row.body_contains,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MonitorRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(scope: Scope): SyntheticMonitor[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM synthetic_monitors
          WHERE project_id = ? AND environment = ?
          ORDER BY name COLLATE NOCASE, created_at`,
      )
      .all(scope.projectId, scope.environment) as unknown as MonitorRow[];
    return rows.map(toMonitor);
  }

  /** All enabled monitors across projects — used by the scheduler. */
  listEnabled(): SyntheticMonitor[] {
    const rows = this.db.prepare('SELECT * FROM synthetic_monitors WHERE enabled = 1').all() as unknown as MonitorRow[];
    return rows.map(toMonitor);
  }

  get(id: string): SyntheticMonitor | undefined {
    const row = this.db.prepare('SELECT * FROM synthetic_monitors WHERE id = ?').get(id) as MonitorRow | undefined;
    return row ? toMonitor(row) : undefined;
  }

  getInScope(scope: Scope, id: string): SyntheticMonitor | undefined {
    const monitor = this.get(id);
    return monitor && monitor.projectId === scope.projectId && monitor.environment === scope.environment
      ? monitor
      : undefined;
  }

  create(scope: Scope, input: NewMonitor): SyntheticMonitor {
    const now = new Date().toISOString();
    const id = createId('mon');
    this.db
      .prepare(
        `INSERT INTO synthetic_monitors
           (id, project_id, environment, name, url, method, interval_seconds, timeout_ms, expected_status,
            follow_redirects, body_contains, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        scope.projectId,
        scope.environment,
        input.name,
        input.url,
        input.method,
        input.intervalSeconds,
        input.timeoutMs,
        input.expectedStatus,
        input.followRedirects ? 1 : 0,
        input.bodyContains ?? '',
        now,
        now,
      );
    return this.get(id)!;
  }

  update(id: string, patch: MonitorPatch): SyntheticMonitor | undefined {
    const assignments: string[] = [];
    const values: (string | number)[] = [];
    for (const [key, value] of Object.entries(patch) as [keyof MonitorPatch, MonitorPatch[keyof MonitorPatch]][]) {
      if (value === undefined) continue;
      assignments.push(`${COLUMNS[key]} = ?`);
      values.push(typeof value === 'boolean' ? Number(value) : value);
    }
    if (assignments.length > 0) {
      assignments.push('updated_at = ?');
      values.push(new Date().toISOString());
      this.db.prepare(`UPDATE synthetic_monitors SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id);
    }
    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM synthetic_monitors WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }
}
