import { statSync } from 'node:fs';
import { RETENTION_SIGNALS, type RetentionSignal, type StorageResponse } from '@minidog/types';
import { SIGNAL_TABLES, type StorageRepository } from '../repositories/storage-repository';

export class StorageService {
  constructor(
    private readonly storage: StorageRepository,
    private readonly sqlitePath: string,
  ) {}

  async overview(): Promise<StorageResponse> {
    const [usage, oldest, retention] = await Promise.all([this.storage.usage(), this.storage.oldest(), this.storage.retention()]);
    return {
      signals: RETENTION_SIGNALS.map((signal) => {
        const table = SIGNAL_TABLES[signal];
        return {
          signal,
          rows: usage.get(table)?.rows ?? 0,
          bytes: usage.get(table)?.bytes ?? 0,
          oldest: oldest.get(table) ?? null,
          retentionDays: retention.get(table) ?? null,
        };
      }),
      sqliteBytes: fileSize(this.sqlitePath) + fileSize(`${this.sqlitePath}-wal`),
    };
  }

  async setRetention(signal: RetentionSignal, days: number): Promise<StorageResponse> {
    await this.storage.setRetention(signal, days);
    return this.overview();
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
