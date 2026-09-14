import type { DatabaseSync } from 'node:sqlite';
import type { AlertEvent, AlertMonitor, AlertMonitorType, AlertState, HostResourceMetric } from '@minidog/types';
import { createId } from '../lib/id';
import type { Scope } from './project-repository';

interface MonitorRow {
  id: string;
  project_id: string;
  environment: string;
  name: string;
  type: string;
  target: string;
  metric: string;
  warning_threshold: number | null;
  critical_threshold: number;
  window_minutes: number;
  webhook_url: string;
  enabled: number;
  state: string;
  state_value: number | null;
  state_message: string;
  state_changed_at: string | null;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  monitor_id: string;
  monitor_name: string;
  from_state: string;
  to_state: string;
  value: number | null;
  message: string;
  created_at: string;
  acknowledged: number;
  webhook_status: string;
}

/** Monitor with the scope it evaluates in. */
export interface ScopedAlertMonitor extends AlertMonitor {
  projectId: string;
  environment: string;
}

export interface NewAlertMonitor {
  name: string;
  type: AlertMonitorType;
  target: string;
  metric: HostResourceMetric | null;
  warningThreshold: number | null;
  criticalThreshold: number;
  windowMinutes: number;
  webhookUrl: string;
}

export type AlertMonitorPatch = Partial<
  Pick<NewAlertMonitor, 'name' | 'warningThreshold' | 'criticalThreshold' | 'windowMinutes' | 'webhookUrl'> & { enabled: boolean }
>;

const COLUMNS: Record<keyof AlertMonitorPatch, string> = {
  name: 'name',
  warningThreshold: 'warning_threshold',
  criticalThreshold: 'critical_threshold',
  windowMinutes: 'window_minutes',
  webhookUrl: 'webhook_url',
  enabled: 'enabled',
};

function toMonitor(row: MonitorRow): ScopedAlertMonitor {
  return {
    id: row.id,
    projectId: row.project_id,
    environment: row.environment,
    name: row.name,
    type: row.type as AlertMonitorType,
    target: row.target,
    metric: (row.metric || null) as HostResourceMetric | null,
    warningThreshold: row.warning_threshold,
    criticalThreshold: row.critical_threshold,
    windowMinutes: row.window_minutes,
    webhookUrl: row.webhook_url,
    enabled: row.enabled === 1,
    state: row.state as AlertState,
    stateValue: row.state_value,
    stateMessage: row.state_message,
    stateChangedAt: row.state_changed_at,
    lastEvaluatedAt: row.last_evaluated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: EventRow): AlertEvent {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    monitorName: row.monitor_name,
    fromState: row.from_state as AlertState,
    toState: row.to_state as AlertState,
    value: row.value,
    message: row.message,
    createdAt: row.created_at,
    acknowledged: row.acknowledged === 1,
    webhookStatus: row.webhook_status,
  };
}

/** Public shape without the scope columns. */
export function publicMonitor({ projectId: _project, environment: _environment, ...monitor }: ScopedAlertMonitor): AlertMonitor {
  return monitor;
}

const EVENT_SELECT = `
  SELECT e.id, e.monitor_id, m.name AS monitor_name, e.from_state, e.to_state, e.value, e.message,
         e.created_at, e.acknowledged, e.webhook_status
    FROM alert_events e
    JOIN alert_monitors m ON m.id = e.monitor_id`;

export class AlertMonitorRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(scope: Scope): ScopedAlertMonitor[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM alert_monitors WHERE project_id = ? AND environment = ? ORDER BY name COLLATE NOCASE, created_at`,
      )
      .all(scope.projectId, scope.environment) as unknown as MonitorRow[];
    return rows.map(toMonitor);
  }

  /** Every enabled monitor across projects — evaluated by the worker. */
  listEnabled(): ScopedAlertMonitor[] {
    const rows = this.db.prepare('SELECT * FROM alert_monitors WHERE enabled = 1').all() as unknown as MonitorRow[];
    return rows.map(toMonitor);
  }

  get(id: string): ScopedAlertMonitor | undefined {
    const row = this.db.prepare('SELECT * FROM alert_monitors WHERE id = ?').get(id) as MonitorRow | undefined;
    return row ? toMonitor(row) : undefined;
  }

  getInScope(scope: Scope, id: string): ScopedAlertMonitor | undefined {
    const monitor = this.get(id);
    return monitor && monitor.projectId === scope.projectId && monitor.environment === scope.environment ? monitor : undefined;
  }

  create(scope: Scope, input: NewAlertMonitor): ScopedAlertMonitor {
    const now = new Date().toISOString();
    const id = createId('alm');
    this.db
      .prepare(
        `INSERT INTO alert_monitors
           (id, project_id, environment, name, type, target, metric, warning_threshold, critical_threshold,
            window_minutes, webhook_url, enabled, state, state_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'no_data', 'Waiting for first evaluation', ?, ?)`,
      )
      .run(
        id,
        scope.projectId,
        scope.environment,
        input.name,
        input.type,
        input.target,
        input.metric ?? '',
        input.warningThreshold,
        input.criticalThreshold,
        input.windowMinutes,
        input.webhookUrl,
        now,
        now,
      );
    return this.get(id)!;
  }

  update(id: string, patch: AlertMonitorPatch): ScopedAlertMonitor | undefined {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(patch) as [keyof AlertMonitorPatch, AlertMonitorPatch[keyof AlertMonitorPatch]][]) {
      if (value === undefined) continue;
      assignments.push(`${COLUMNS[key]} = ?`);
      values.push(typeof value === 'boolean' ? Number(value) : value);
    }
    if (assignments.length > 0) {
      assignments.push('updated_at = ?');
      values.push(new Date().toISOString());
      this.db.prepare(`UPDATE alert_monitors SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id);
    }
    return this.get(id);
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM alert_monitors WHERE id = ?').run(id).changes) > 0;
  }

  /** Stores an evaluation; a state change also records an event. Returns the event, if any. */
  recordEvaluation(
    monitor: ScopedAlertMonitor,
    result: { state: AlertState; value: number | null; message: string },
    at: Date,
  ): AlertEvent | null {
    const now = at.toISOString();
    const changed = result.state !== monitor.state;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `UPDATE alert_monitors
              SET state = ?, state_value = ?, state_message = ?, last_evaluated_at = ?,
                  state_changed_at = CASE WHEN ? THEN ? ELSE state_changed_at END
            WHERE id = ?`,
        )
        .run(result.state, result.value, result.message, now, changed ? 1 : 0, now, monitor.id);

      let eventId: string | null = null;
      if (changed) {
        eventId = createId('ale');
        this.db
          .prepare(
            `INSERT INTO alert_events (id, monitor_id, project_id, environment, from_state, to_state, value, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(eventId, monitor.id, monitor.projectId, monitor.environment, monitor.state, result.state, result.value, result.message, now);
      }
      this.db.exec('COMMIT');
      return eventId ? this.event(eventId) : null;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  event(id: string): AlertEvent | null {
    const row = this.db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id) as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  setWebhookStatus(eventId: string, status: string): void {
    this.db.prepare('UPDATE alert_events SET webhook_status = ? WHERE id = ?').run(status, eventId);
  }

  eventsForMonitor(monitorId: string, limit: number): AlertEvent[] {
    const rows = this.db
      .prepare(`${EVENT_SELECT} WHERE e.monitor_id = ? ORDER BY e.created_at DESC LIMIT ?`)
      .all(monitorId, limit) as unknown as EventRow[];
    return rows.map(toEvent);
  }

  recentEvents(scope: Scope, limit: number): AlertEvent[] {
    const rows = this.db
      .prepare(`${EVENT_SELECT} WHERE e.project_id = ? AND e.environment = ? ORDER BY e.created_at DESC LIMIT ?`)
      .all(scope.projectId, scope.environment, limit) as unknown as EventRow[];
    return rows.map(toEvent);
  }

  unreadCount(scope: Scope): number {
    const row = this.db
      .prepare('SELECT count(*) AS count FROM alert_events WHERE project_id = ? AND environment = ? AND acknowledged = 0')
      .get(scope.projectId, scope.environment) as { count: number };
    return row.count;
  }

  acknowledgeAll(scope: Scope): void {
    this.db
      .prepare('UPDATE alert_events SET acknowledged = 1 WHERE project_id = ? AND environment = ? AND acknowledged = 0')
      .run(scope.projectId, scope.environment);
  }
}
