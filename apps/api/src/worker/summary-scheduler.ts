import type { FastifyBaseLogger } from 'fastify';
import type { SummaryService } from '../services/summary-service';

const TICK_MS = 60_000;

/** Checks every minute whether the day's summary is due. */
export class SummaryScheduler {
  private timer: NodeJS.Timeout | undefined;
  private sending = false;

  constructor(
    private readonly summary: SummaryService,
    private readonly log: FastifyBaseLogger,
    /** Right after waking, the network may still be reconnecting. */
    private readonly gaps?: { settling(now?: number): boolean },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    // Soon after startup too, so a summary missed while minidog was off goes out.
    setTimeout(() => void this.tick(), 15_000).unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (!this.timer || this.sending || this.gaps?.settling()) return;
    this.sending = true;
    try {
      await this.summary.sendIfDue();
    } catch (error) {
      this.log.warn({ err: error }, 'Summary not sent; retrying in a minute');
    } finally {
      this.sending = false;
    }
  }
}
