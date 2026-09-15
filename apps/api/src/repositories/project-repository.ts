import type { DatabaseSync } from 'node:sqlite';
import type { ProjectInfo } from '@minidog/types';
import { createId } from '../lib/id';

export interface Scope {
  projectId: string;
  environment: string;
}

export interface ProjectContext extends Scope {
  projectName: string;
}

const DEFAULT_PROJECT_NAME = 'Personal';
const DEFAULT_ENVIRONMENT = 'production';
const ACTIVE_SCOPE_KEY = 'active_scope';

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
}

interface EnvironmentRow {
  project_id: string;
  name: string;
  created_at: string;
}

export class ProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * The first project and its first environment are the default: telemetry
   * without an API key lands there. Created on first start.
   */
  ensureDefault(): ProjectContext {
    const existing = this.db
      .prepare(
        `SELECT p.id AS project_id, p.name AS project_name, e.name AS environment
           FROM projects p
           JOIN environments e ON e.project_id = p.id
          ORDER BY p.created_at, e.created_at
          LIMIT 1`,
      )
      .get() as { project_id: string; project_name: string; environment: string } | undefined;

    if (existing) {
      return { projectId: existing.project_id, projectName: existing.project_name, environment: existing.environment };
    }
    const project = this.create(DEFAULT_PROJECT_NAME, DEFAULT_ENVIRONMENT);
    return { projectId: project.id, projectName: project.name, environment: DEFAULT_ENVIRONMENT };
  }

  list(): ProjectInfo[] {
    const projects = this.db
      .prepare('SELECT id, name, created_at FROM projects ORDER BY created_at')
      .all() as unknown as ProjectRow[];
    const environments = this.db
      .prepare('SELECT project_id, name, created_at FROM environments ORDER BY created_at')
      .all() as unknown as EnvironmentRow[];
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.created_at,
      environments: environments
        .filter((environment) => environment.project_id === project.id)
        .map((environment) => ({ name: environment.name, createdAt: environment.created_at })),
    }));
  }

  get(id: string): ProjectInfo | undefined {
    return this.list().find((project) => project.id === id);
  }

  create(name: string, environment: string): ProjectInfo {
    const now = new Date().toISOString();
    const id = createId('prj');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now);
      this.db
        .prepare('INSERT INTO environments (id, project_id, name, created_at) VALUES (?, ?, ?, ?)')
        .run(createId('env'), id, environment, now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.get(id)!;
  }

  addEnvironment(projectId: string, name: string): ProjectInfo {
    this.db
      .prepare('INSERT INTO environments (id, project_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(createId('env'), projectId, name, new Date().toISOString());
    return this.get(projectId)!;
  }

  hasEnvironment(projectId: string, name: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM environments WHERE project_id = ? AND name = ?').get(projectId, name) !== undefined
    );
  }

  /** Project and environment the dashboard last showed; null if unset or gone. */
  activeScope(): Scope | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(ACTIVE_SCOPE_KEY) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      const scope = JSON.parse(row.value) as Scope;
      return this.hasEnvironment(scope.projectId, scope.environment) ? scope : null;
    } catch {
      return null;
    }
  }

  setActiveScope(scope: Scope): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(ACTIVE_SCOPE_KEY, JSON.stringify({ projectId: scope.projectId, environment: scope.environment }));
  }
}
