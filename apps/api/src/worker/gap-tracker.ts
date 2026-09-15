import type { FastifyBaseLogger } from 'fastify';
import type { GapRepository } from '../repositories/gap-repository';

/** A timer this much later than planned means the process was suspended (the machine slept). */
export const SLEEP_THRESHOLD_MS = 60_000;
/** After waking, the network may take a while to come back; checks and alerts wait this long. */
export const WAKE_SETTLE_MS = 45_000;
const TICK_MS = 10_000;
const HEARTBEAT_MS = 30_000;
/** A heartbeat older than this at startup means minidog was not running in between. */
const STOPPED_THRESHOLD_MS = 2 * 60_000;

export interface GapTrackerOptions {
  now?: () => number;
}

/**
 * Notices when nothing could be measured: minidog was not running (an old
 * heartbeat at startup) or the machine slept (a timer that fired far too late).
 * Such stretches are recorded so empty time reads as "not measured", and for a
 * short while after waking, checks and alerts hold off.
 */
export class GapTracker {
  private timer: NodeJS.Timeout | undefined;
  private lastTick = 0;
  private lastHeartbeat = 0;
  private wokeAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly gaps: GapRepository,
    private readonly log: FastifyBaseLogger,
    private readonly options: GapTrackerOptions = {},
  ) {}

  start(): void {
    const now = this.now();
    const last = this.gaps.heartbeat();
    if (last !== null && now - last > STOPPED_THRESHOLD_MS) {
      this.gaps.record(last, now, 'stopped');
      this.log.info({ since: new Date(last).toISOString() }, 'Measurement gap recorded: minidog was not running');
    }
    this.beat(now);
    this.lastTick = now;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.beat(this.now());
  }

  /** Runs every few seconds; public for tests. */
  tick(): void {
    const now = this.now();
    if (now - this.lastTick > TICK_MS + SLEEP_THRESHOLD_MS) this.noteSleep(this.lastTick, now);
    this.lastTick = now;
    if (now - this.lastHeartbeat >= HEARTBEAT_MS) this.beat(now);
  }

  /** The process was suspended between `from` and `to`; also reported by late scheduler timers. */
  noteSleep(from: number, to: number): void {
    const known = from < this.wokeAt;
    this.gaps.record(from, to, 'asleep');
    this.wokeAt = Math.max(this.wokeAt, to);
    this.beat(to);
    if (!known) this.log.info({ since: new Date(from).toISOString() }, 'Measurement gap recorded: the machine was asleep');
  }

  /** True shortly after waking, while the network may still be reconnecting. */
  settling(now: number = this.now()): boolean {
    return now < this.settledAt();
  }

  /** Epoch ms when checks may run again after the last wake. */
  settledAt(): number {
    return this.wokeAt + WAKE_SETTLE_MS;
  }

  private beat(at: number): void {
    this.gaps.setHeartbeat(at);
    this.lastHeartbeat = at;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
