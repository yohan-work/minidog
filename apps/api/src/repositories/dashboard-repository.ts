import type { DatabaseSync } from 'node:sqlite';
import type { Dashboard, DashboardSummary, DashboardWidget } from '@minidog/types';
import { createId } from '../lib/id';
import type { Scope } from './project-repository';

interface DashboardRow {
  id: string;
  name: string;
  widgets: string;
  created_at: string;
  updated_at: string;
}

function parseWidgets(json: string): DashboardWidget[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? (value as DashboardWidget[]) : [];
  } catch {
    return [];
  }
}

const toDashboard = (row: DashboardRow): Dashboard => ({
  id: row.id,
  name: row.name,
  widgets: parseWidgets(row.widgets),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Dashboards of one project and environment; a widget list is saved as a whole. */
export class DashboardRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(scope: Scope): DashboardSummary[] {
    const rows = this.db
      .prepare('SELECT id, name, widgets, created_at, updated_at FROM dashboards WHERE project_id = ? AND environment = ? ORDER BY name COLLATE NOCASE')
      .all(scope.projectId, scope.environment) as unknown as DashboardRow[];
    return rows.map((row) => ({ id: row.id, name: row.name, widgetCount: parseWidgets(row.widgets).length, updatedAt: row.updated_at }));
  }

  get(scope: Scope, id: string): Dashboard | undefined {
    const row = this.db
      .prepare('SELECT id, name, widgets, created_at, updated_at FROM dashboards WHERE id = ? AND project_id = ? AND environment = ?')
      .get(id, scope.projectId, scope.environment) as unknown as DashboardRow | undefined;
    return row ? toDashboard(row) : undefined;
  }

  create(scope: Scope, name: string, widgets: readonly DashboardWidget[] = []): Dashboard {
    const id = createId('dsh');
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO dashboards (id, project_id, environment, name, widgets, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, scope.projectId, scope.environment, name, JSON.stringify(widgets), now, now);
    return this.get(scope, id)!;
  }

  /** Replaces the name and the whole widget list. */
  update(scope: Scope, id: string, name: string, widgets: readonly DashboardWidget[]): Dashboard | undefined {
    const result = this.db
      .prepare('UPDATE dashboards SET name = ?, widgets = ?, updated_at = ? WHERE id = ? AND project_id = ? AND environment = ?')
      .run(name, JSON.stringify(widgets), new Date().toISOString(), id, scope.projectId, scope.environment);
    return Number(result.changes) > 0 ? this.get(scope, id) : undefined;
  }

  delete(scope: Scope, id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM dashboards WHERE id = ? AND project_id = ? AND environment = ?')
      .run(id, scope.projectId, scope.environment);
    return Number(result.changes) > 0;
  }
}
