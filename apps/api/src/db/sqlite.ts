import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Append-only list. Each entry runs once, in order, tracked by `user_version`.
 */
const MIGRATIONS: readonly string[] = [
  /* 1 — projects, environments, synthetic monitors */ `
  CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE environments (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (project_id, name)
  );

  CREATE TABLE synthetic_monitors (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment       TEXT NOT NULL,
    name              TEXT NOT NULL,
    url               TEXT NOT NULL,
    method            TEXT NOT NULL,
    interval_seconds  INTEGER NOT NULL,
    timeout_ms        INTEGER NOT NULL,
    expected_status   TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE INDEX synthetic_monitors_scope ON synthetic_monitors (project_id, environment);
  `,
  /* 2 — alert monitors and their state history */ `
  CREATE TABLE alert_monitors (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment         TEXT NOT NULL,
    name                TEXT NOT NULL,
    type                TEXT NOT NULL,
    target              TEXT NOT NULL,
    metric              TEXT NOT NULL DEFAULT '',
    warning_threshold   REAL,
    critical_threshold  REAL NOT NULL,
    window_minutes      INTEGER NOT NULL,
    webhook_url         TEXT NOT NULL DEFAULT '',
    enabled             INTEGER NOT NULL DEFAULT 1,
    state               TEXT NOT NULL DEFAULT 'no_data',
    state_value         REAL,
    state_message       TEXT NOT NULL DEFAULT '',
    state_changed_at    TEXT,
    last_evaluated_at   TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE INDEX alert_monitors_scope ON alert_monitors (project_id, environment);

  CREATE TABLE alert_events (
    id              TEXT PRIMARY KEY,
    monitor_id      TEXT NOT NULL REFERENCES alert_monitors(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL,
    environment     TEXT NOT NULL,
    from_state      TEXT NOT NULL,
    to_state        TEXT NOT NULL,
    value           REAL,
    message         TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    acknowledged    INTEGER NOT NULL DEFAULT 0,
    webhook_status  TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX alert_events_monitor ON alert_events (monitor_id, created_at);
  CREATE INDEX alert_events_scope ON alert_events (project_id, environment, created_at);
  `,
  /* 3 — ingest API keys and app settings */ `
  CREATE TABLE api_keys (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment   TEXT NOT NULL,
    name          TEXT NOT NULL,
    prefix        TEXT NOT NULL,
    hash          TEXT NOT NULL UNIQUE,
    created_at    TEXT NOT NULL,
    last_used_at  TEXT,
    revoked_at    TEXT
  );

  CREATE INDEX api_keys_project ON api_keys (project_id);

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,
  /* 4 — alert noise control: transition delays, mute, pending state */ `
  ALTER TABLE alert_monitors ADD COLUMN alert_after_minutes INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE alert_monitors ADD COLUMN recover_after_minutes INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE alert_monitors ADD COLUMN muted_until TEXT;
  ALTER TABLE alert_monitors ADD COLUMN pending_state TEXT;
  ALTER TABLE alert_monitors ADD COLUMN pending_since TEXT;
  `,
  /* 5 — synthetic checks: follow redirects, required response text */ `
  ALTER TABLE synthetic_monitors ADD COLUMN follow_redirects INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE synthetic_monitors ADD COLUMN body_contains TEXT NOT NULL DEFAULT '';
  `,
  /* 6 — measurement gaps: minidog not running or the machine asleep */ `
  CREATE TABLE measurement_gaps (
    id          INTEGER PRIMARY KEY,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER NOT NULL,
    reason      TEXT NOT NULL
  );

  CREATE INDEX measurement_gaps_ended ON measurement_gaps (ended_at);
  `,
  /* 7 — dashboards: widgets kept as a JSON array in display order */ `
  CREATE TABLE dashboards (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment  TEXT NOT NULL,
    name         TEXT NOT NULL,
    widgets      TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE INDEX dashboards_scope ON dashboards (project_id, environment);
  `,
  /* 8 — dashboard sign-in: sessions by token hash (the password hash lives in settings) */ `
  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
  `,
  /* 9 — heartbeat monitors: pings by token (the monitor's target) */ `
  ALTER TABLE alert_monitors ADD COLUMN last_ping_at TEXT;
  ALTER TABLE alert_monitors ADD COLUMN ping_count INTEGER NOT NULL DEFAULT 0;

  CREATE INDEX alert_monitors_target ON alert_monitors (type, target);
  `,
  /* 10 — alert emails alongside webhooks */ `
  ALTER TABLE alert_monitors ADD COLUMN email TEXT NOT NULL DEFAULT '';
  ALTER TABLE alert_events ADD COLUMN email_status TEXT NOT NULL DEFAULT '';
  `,
];

/** The schema this build knows: `user_version` equals it once every migration has run. */
export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  // Going back to an older image would otherwise start quietly against a schema
  // this build does not know, and write rows the newer one cannot read.
  if (row.user_version > MIGRATIONS.length) {
    throw new Error(
      `This data was written by a newer minidog: it is at schema ${row.user_version}, and this build knows ${MIGRATIONS.length}. ` +
        'Run the newer version again, or restore the data from before the upgrade.',
    );
  }
  for (let version = row.user_version; version < MIGRATIONS.length; version += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
