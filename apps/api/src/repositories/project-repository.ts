import type { DatabaseSync } from 'node:sqlite';
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

export class ProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * V0.1 runs with a single project and environment. Project management UI and
   * API keys arrive with OTLP ingestion.
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

    const now = new Date().toISOString();
    const projectId = createId('prj');
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)')
        .run(projectId, DEFAULT_PROJECT_NAME, now);
      this.db
        .prepare('INSERT INTO environments (id, project_id, name, created_at) VALUES (?, ?, ?, ?)')
        .run(createId('env'), projectId, DEFAULT_ENVIRONMENT, now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { projectId, projectName: DEFAULT_PROJECT_NAME, environment: DEFAULT_ENVIRONMENT };
  }
}
