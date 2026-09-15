import type { DatabaseSync } from 'node:sqlite';
import type { AlertEvent, AlertMetric, AlertMonitor, AlertMonitorType, AlertState } from '@minidog/types';
import { createId } from '../lib/id';
import { applyTransitionDelay } from '../services/alert-state';
import type { Scope } from './project-repository';

interface MonitorRow {
  id: string;
  project_id: string;
  environment: string;
  name: string;
  type: string;
  target: string;
  target_label: string;
  metric: string;
  warning_threshold: number | null;
  critical_threshold: number;
  window_minutes: number;
  webhook_url: string;
  alert_after_minutes: number;
  recover_after_minutes: number;
  muted_until: string | null;
  enabled: number;
  state: string;
  pending_state: string | null;
  pending_since: string | null;
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
  metric: AlertMetric | null;
  warningThreshold: number | null;
  criticalThreshold: number;
  windowMinutes: number;
  webhookUrl: string;
  alertAfterMinutes?: number;
  recoverAfterMinutes?: number;
}

export type AlertMonitorPatch = Partial<
  Pick<
    NewAlertMonitor,
    | 'name'
    | 'warningThreshold'
    | 'criticalThreshold'
    | 'windowMinutes'
    | 'webhookUrl'
    | 'alertAfterMinutes'
    | 'recoverAfterMinutes'
  > & { enabled: boolean; mutedUntil: string | null }
>;

const COLUMNS: Record<keyof AlertMonitorPatch, string> = {
  name: 'name',
  warningThreshold: 'warning_threshold',
  criticalThreshold: 'critical_threshold',
  windowMinutes: 'window_minutes',
  webhookUrl: 'webhook_url',
  alertAfterMinutes: 'alert_after_minutes',
  recoverAfterMinutes: 'recover_after_minutes',
  mutedUntil: 'muted_until',
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
    targetLabel: row.target_label,
    metric: (row.metric || null) as AlertMetric | null,
    warningThreshold: row.warning_threshold,
    criticalThreshold: row.critical_threshold,
    windowMinutes: row.window_minutes,
    webhookUrl: row.webhook_url,
    alertAfterMinutes: row.alert_after_minutes,
    recoverAfterMinutes: row.recover_after_minutes,
    mutedUntil: row.muted_until,
    enabled: row.enabled === 1,
    state: row.state as AlertState,
    pendingState: row.pending_state as AlertState | null,
    pendingSince: row.pending_since,
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
export function publicMonitor({
  projectId: _project,
  environment: _environment,
  ...monitor
}: ScopedAlertMonitor): AlertMonitor {
  return monitor;
}

// Synthetic targets are stored by id; their current name is the label.
const MONITOR_SELECT = `
  SELECT m.*, COALESCE(s.name, m.target) AS target_label
    FROM alert_monitors m
    LEFT JOIN synthetic_monitors s ON m.type = 'synthetic_check' AND s.id = m.target`;

const EVENT_SELECT = `
  SELECT e.id, e.monitor_id, m.name AS monitor_name, e.from_state, e.to_state, e.value, e.message,
         e.created_at, e.acknowledged, e.webhook_status
    FROM alert_events e
    JOIN alert_monitors m ON m.id = e.monitor_id`;

/** Webhook status of a notification held back by a mute. */
export const MUTED_WEBHOOK_STATUS = 'muted';

export class AlertMonitorRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(scope: Scope): ScopedAlertMonitor[] {
    const rows = this.db
      .prepare(
        `${MONITOR_SELECT} WHERE m.project_id = ? AND m.environment = ? ORDER BY m.name COLLATE NOCASE, m.created_at`,
      )
      .all(scope.projectId, scope.environment) as unknown as MonitorRow[];
    return rows.map(toMonitor);
  }

  /** Every enabled monitor across projects — evaluated by the worker. */
  listEnabled(): ScopedAlertMonitor[] {
    const rows = this.db.prepare(`${MONITOR_SELECT} WHERE m.enabled = 1`).all() as unknown as MonitorRow[];
    return rows.map(toMonitor);
  }

  get(id: string): ScopedAlertMonitor | undefined {
    const row = this.db.prepare(`${MONITOR_SELECT} WHERE m.id = ?`).get(id) as MonitorRow | undefined;
    return row ? toMonitor(row) : undefined;
  }

  getInScope(scope: Scope, id: string): ScopedAlertMonitor | undefined {
    const monitor = this.get(id);
    return monitor && monitor.projectId === scope.projectId && monitor.environment === scope.environment
      ? monitor
      : undefined;
  }

  create(scope: Scope, input: NewAlertMonitor): ScopedAlertMonitor {
    const now = new Date().toISOString();
    const id = createId('alm');
    this.db
      .prepare(
        `INSERT INTO alert_monitors
           (id, project_id, environment, name, type, target, metric, warning_threshold, critical_threshold,
            window_minutes, webhook_url, alert_after_minutes, recover_after_minutes, enabled, state, state_message,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'no_data', 'Waiting for first evaluation', ?, ?)`,
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
        input.alertAfterMinutes ?? 0,
        input.recoverAfterMinutes ?? 0,
        now,
        now,
      );
    return this.get(id)!;
  }

  update(id: string, patch: AlertMonitorPatch): ScopedAlertMonitor | undefined {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(patch) as [
      keyof AlertMonitorPatch,
      AlertMonitorPatch[keyof AlertMonitorPatch],
    ][]) {
      if (value === undefined) continue;
      assignments.push(`${COLUMNS[key]} = ?`);
      values.push(typeof value === 'boolean' ? Number(value) : value);
    }
    // Pausing or resuming ends any pending transition: the paused time was not measured.
    if (patch.enabled !== undefined) assignments.push('pending_state = NULL', 'pending_since = NULL');
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

  /**
   * Stores an evaluation; a state change also records an event. Returns the event, if any.
   *
   * `result.state` is what the measurement points to. Whether the monitor
   * enters it now depends on alertAfter/recoverAfter and on how long it has
   * been pending — all read inside the transaction rather than taken from
   * `monitor`: two evaluations started from the same snapshot (the interval and
   * "Evaluate now") must not record — and notify — the same transition twice.
   */
  recordEvaluation(
    monitor: ScopedAlertMonitor,
    result: { state: AlertState; value: number | null; message: string },
    at: Date,
    /** Longest gap between evaluations that keeps a pending clock running. */
    maxGapMs: number = Number.POSITIVE_INFINITY,
  ): AlertEvent | null {
    const now = at.toISOString();
    let eventId: string | null = null;
    this.db.exec('BEGIN');
    try {
      const stored = this.db
        .prepare(
          `SELECT state, pending_state, pending_since, last_evaluated_at, alert_after_minutes, recover_after_minutes
             FROM alert_monitors WHERE id = ?`,
        )
        .get(monitor.id) as
        | {
            state: AlertState;
            pending_state: AlertState | null;
            pending_since: string | null;
            last_evaluated_at: string | null;
            alert_after_minutes: number;
            recover_after_minutes: number;
          }
        | undefined;
      // A monitor deleted while it was being measured has nothing to record.
      if (stored) {
        const next = applyTransitionDelay({
          stored: stored.state,
          pending:
            stored.pending_state && stored.pending_since
              ? { state: stored.pending_state, since: stored.pending_since }
              : null,
          derived: result.state,
          at,
          alertAfterMinutes: stored.alert_after_minutes,
          recoverAfterMinutes: stored.recover_after_minutes,
          lastEvaluatedAt: stored.last_evaluated_at,
          maxGapMs,
        });
        const changed = next.state !== stored.state;
        this.db
          .prepare(
            `UPDATE alert_monitors
                SET state = ?, state_value = ?, state_message = ?, last_evaluated_at = ?,
                    pending_state = ?, pending_since = ?,
                    state_changed_at = CASE WHEN ? THEN ? ELSE state_changed_at END
              WHERE id = ?`,
          )
          .run(
            next.state,
            result.value,
            result.message,
            now,
            next.pending?.state ?? null,
            next.pending?.since ?? null,
            changed ? 1 : 0,
            now,
            monitor.id,
          );

        if (changed) {
          eventId = createId('ale');
          this.db
            .prepare(
              `INSERT INTO alert_events (id, monitor_id, project_id, environment, from_state, to_state, value, message, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              eventId,
              monitor.id,
              monitor.projectId,
              monitor.environment,
              stored.state,
              next.state,
              result.value,
              result.message,
              now,
            );
        }
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

  lastEvent(monitorId: string): AlertEvent | null {
    const row = this.db
      .prepare(`${EVENT_SELECT} WHERE e.monitor_id = ? ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1`)
      .get(monitorId) as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  setWebhookStatus(eventId: string, status: string): void {
    this.db.prepare('UPDATE alert_events SET webhook_status = ? WHERE id = ?').run(status, eventId);
  }

  /** Takes a notification held by a mute for delivery. False when another evaluation already took it. */
  claimMutedEvent(eventId: string): boolean {
    const result = this.db
      .prepare(`UPDATE alert_events SET webhook_status = 'sending' WHERE id = ? AND webhook_status = ?`)
      .run(eventId, MUTED_WEBHOOK_STATUS);
    return Number(result.changes) > 0;
  }

  eventsForMonitor(monitorId: string, limit: number): AlertEvent[] {
    const rows = this.db
      .prepare(`${EVENT_SELECT} WHERE e.monitor_id = ? ORDER BY e.created_at DESC LIMIT ?`)
      .all(monitorId, limit) as unknown as EventRow[];
    return rows.map(toEvent);
  }

  /** State changes in every project since `fromIso`, oldest first. */
  eventsSince(fromIso: string): AlertEvent[] {
    const rows = this.db
      .prepare(`${EVENT_SELECT} WHERE e.created_at >= ? ORDER BY e.created_at`)
      .all(fromIso) as unknown as EventRow[];
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
      .prepare(
        'SELECT count(*) AS count FROM alert_events WHERE project_id = ? AND environment = ? AND acknowledged = 0',
      )
      .get(scope.projectId, scope.environment) as { count: number };
    return row.count;
  }

  acknowledgeAll(scope: Scope): void {
    this.db
      .prepare('UPDATE alert_events SET acknowledged = 1 WHERE project_id = ? AND environment = ? AND acknowledged = 0')
      .run(scope.projectId, scope.environment);
  }
}
