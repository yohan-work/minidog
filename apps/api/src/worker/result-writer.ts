import type { FastifyBaseLogger } from 'fastify';
import type { SyntheticResultRepository, SyntheticResultRow } from '../repositories/synthetic-result-repository';

const FLUSH_INTERVAL_MS = 1_000;
const MAX_BATCH = 500;
/** Upper bound while ClickHouse is unreachable; oldest rows are dropped first. */
const MAX_BUFFER = 10_000;

/**
 * Buffers check results and writes them to ClickHouse in batches. Failed
 * batches are kept and retried on the next tick.
 */
export class ResultWriter {
  private buffer: SyntheticResultRow[] = [];
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | null = null;
  private failing = false;

  constructor(
    private readonly results: SyntheticResultRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  start(): void {
    this.timer ??= setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.flushAll();
  }

  push(row: SyntheticResultRow): void {
    this.buffer.push(row);
    if (this.buffer.length > MAX_BUFFER) {
      const dropped = this.buffer.length - MAX_BUFFER;
      this.buffer.splice(0, dropped);
      this.log.warn({ dropped }, 'Synthetic result buffer full; dropped oldest results');
    }
    if (this.buffer.length >= MAX_BATCH) void this.flush();
  }

  /** Writes everything buffered so far. Resolves false if a write failed. */
  async flushAll(): Promise<boolean> {
    while (this.buffer.length > 0 || this.inFlight) {
      await this.flush();
      if (this.failing) return false;
    }
    return true;
  }

  private flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.buffer.length === 0) return Promise.resolve();

    const batch = this.buffer.splice(0, MAX_BATCH);
    this.inFlight = this.results
      .insert(batch)
      .then(() => {
        if (this.failing) this.log.info('Writing synthetic results to ClickHouse again');
        this.failing = false;
      })
      .catch((error: unknown) => {
        this.buffer.unshift(...batch);
        if (!this.failing) this.log.warn({ err: error }, 'Failed to write synthetic results; will retry');
        this.failing = true;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
