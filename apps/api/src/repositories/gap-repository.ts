import type { DatabaseSync } from 'node:sqlite';
import type { MeasurementGap, MeasurementGapReason } from '@minidog/types';

const HEARTBEAT_KEY = 'heartbeat_at';

interface GapRow {
  id: number;
  started_at: number;
  ended_at: number;
  reason: string;
}

/** Stretches when nothing was measured, and the heartbeat that reveals them. */
export class GapRepository {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Records a gap. One that overlaps or touches the latest gap for the same
   * reason extends it; for another reason it starts where the latest one ends.
   */
  record(from: number, to: number, reason: MeasurementGapReason): void {
    const last = this.db
      .prepare('SELECT id, started_at, ended_at, reason FROM measurement_gaps ORDER BY ended_at DESC LIMIT 1')
      .get() as unknown as GapRow | undefined;
    const overlaps = last !== undefined && from <= last.ended_at && to >= last.started_at;
    if (overlaps && last.reason === reason) {
      this.db
        .prepare('UPDATE measurement_gaps SET started_at = ?, ended_at = ? WHERE id = ?')
        .run(Math.min(from, last.started_at), Math.max(to, last.ended_at), last.id);
      return;
    }
    const start = overlaps ? Math.max(from, last.ended_at) : from;
    if (to <= start) return;
    this.db.prepare('INSERT INTO measurement_gaps (started_at, ended_at, reason) VALUES (?, ?, ?)').run(start, to, reason);
  }

  /** Gaps overlapping [fromMs, toMs], oldest first, clipped to that window. */
  list(fromMs: number, toMs: number): MeasurementGap[] {
    const rows = this.db
      .prepare('SELECT id, started_at, ended_at, reason FROM measurement_gaps WHERE ended_at > ? AND started_at < ? ORDER BY started_at')
      .all(fromMs, toMs) as unknown as GapRow[];
    return rows.map((row) => ({
      from: Math.max(row.started_at, fromMs),
      to: Math.min(row.ended_at, toMs),
      reason: row.reason === 'asleep' ? 'asleep' : 'stopped',
    }));
  }

  /** Epoch ms of the last sign of life, or null before the first run. */
  heartbeat(): number | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(HEARTBEAT_KEY) as unknown as { value: string } | undefined;
    const value = Number(row?.value);
    return row && Number.isFinite(value) ? value : null;
  }

  setHeartbeat(at: number): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(HEARTBEAT_KEY, String(at));
  }
}
