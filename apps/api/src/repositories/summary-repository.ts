import type { DatabaseSync } from 'node:sqlite';
import { SUMMARY_DEFAULTS, type SummarySettings } from '@minidog/types';

const SETTINGS_KEY = 'summary_settings';
const LAST_KEY = 'summary_last';

export interface LastSummary {
  /** Local date (`YYYY-MM-DD`) the last scheduled summary was for. */
  date: string | null;
  sentAt: string | null;
  status: string;
  /** Set after a failed send; the day's summary is retried a while later. */
  failedAt?: string;
}

/** Summary settings and the last scheduled send, kept in the settings table. */
export class SummaryRepository {
  constructor(private readonly db: DatabaseSync) {}

  settings(): SummarySettings {
    return { ...SUMMARY_DEFAULTS, ...this.read<Partial<SummarySettings>>(SETTINGS_KEY) };
  }

  saveSettings(settings: SummarySettings): void {
    this.write(SETTINGS_KEY, settings);
  }

  last(): LastSummary {
    return { date: null, sentAt: null, status: '', ...this.read<Partial<LastSummary>>(LAST_KEY) };
  }

  saveLast(last: LastSummary): void {
    this.write(LAST_KEY, last);
  }

  private read<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  private write(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }
}
