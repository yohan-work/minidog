import { type ApiClientError, apiFetch, toApiClientError } from './api-client';

/** What a subscriber sees for one path. Stable by reference until the path is loaded again. */
export interface ApiSnapshot<T> {
  data?: T;
  /** Error of the latest attempt. Data from an earlier success is kept (stale). */
  error?: ApiClientError;
  /** Epoch ms of the last successful load. */
  updatedAt?: number;
}

export const EMPTY_SNAPSHOT: ApiSnapshot<never> = Object.freeze({});

type Listener = () => void;

interface Entry {
  snapshot: ApiSnapshot<unknown>;
  /** Refresh interval each subscriber asked for; the path polls at the shortest. */
  listeners: Map<Listener, number>;
  inflight: AbortController | null;
  timer: ReturnType<typeof setInterval> | null;
  timerMs: number;
}

export interface ApiStoreOptions {
  fetcher?: (path: string, signal: AbortSignal) => Promise<unknown>;
  now?: () => number;
  /** Polling pauses while this is false, e.g. in a background tab. */
  isVisible?: () => boolean;
  /** Paths nobody is subscribed to stay cached up to this many; the oldest idle one goes first. */
  maxIdle?: number;
}

/**
 * One request and one timer per path, however many components ask for it.
 *
 * Screens are built from independent components that each load their own
 * path, so the same list is often wanted twice at once (the top bar and the
 * page it sits on, a dashboard and its widgets) and every mount started its
 * own fetch and its own interval. Subscribers to a path now share both, and
 * a path keeps its last response after the last subscriber leaves, so coming
 * back to a screen shows what it showed before while the fresh load runs.
 */
export class ApiStore {
  private readonly entries = new Map<string, Entry>();
  /** Paths without subscribers, oldest first. */
  private readonly idle: string[] = [];
  private readonly fetcher: NonNullable<ApiStoreOptions['fetcher']>;
  private readonly now: () => number;
  private readonly isVisible: () => boolean;
  private readonly maxIdle: number;

  constructor(options: ApiStoreOptions = {}) {
    this.fetcher = options.fetcher ?? ((path, signal) => apiFetch(path, { signal }));
    this.now = options.now ?? Date.now;
    this.isVisible =
      options.isVisible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
    this.maxIdle = options.maxIdle ?? 50;
  }

  peek<T>(path: string): ApiSnapshot<T> {
    return (this.entries.get(path)?.snapshot as ApiSnapshot<T> | undefined) ?? EMPTY_SNAPSHOT;
  }

  /**
   * Starts loading the path (or joins the load in progress), then polls it
   * every `refreshMs` while the tab is visible. Returns the unsubscribe.
   */
  subscribe(path: string, refreshMs: number, listener: Listener): () => void {
    const entry = this.entry(path);
    entry.listeners.set(listener, refreshMs);
    this.unidle(path);
    this.reschedule(path, entry);
    void this.load(path, entry);

    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size > 0) {
        this.reschedule(path, entry);
        return;
      }
      this.stopTimer(entry);
      entry.inflight?.abort();
      entry.inflight = null;
      this.idle.push(path);
      while (this.idle.length > this.maxIdle) {
        const oldest = this.idle.shift();
        if (oldest !== undefined) this.entries.delete(oldest);
      }
    };
  }

  /** Loads the path again now; a load in progress is left to finish instead. */
  refetch(path: string): void {
    const entry = this.entries.get(path);
    if (entry) void this.load(path, entry);
  }

  private entry(path: string): Entry {
    let entry = this.entries.get(path);
    if (!entry) {
      entry = { snapshot: EMPTY_SNAPSHOT, listeners: new Map(), inflight: null, timer: null, timerMs: 0 };
      this.entries.set(path, entry);
    }
    return entry;
  }

  private unidle(path: string): void {
    const index = this.idle.indexOf(path);
    if (index !== -1) this.idle.splice(index, 1);
  }

  private reschedule(path: string, entry: Entry): void {
    const wanted = Math.min(...entry.listeners.values());
    if (entry.timer && entry.timerMs === wanted) return;
    this.stopTimer(entry);
    entry.timerMs = wanted;
    entry.timer = setInterval(() => {
      if (this.isVisible()) void this.load(path, entry);
    }, wanted);
  }

  private stopTimer(entry: Entry): void {
    if (entry.timer) clearInterval(entry.timer);
    entry.timer = null;
  }

  private async load(path: string, entry: Entry): Promise<void> {
    if (entry.inflight) return;
    const controller = new AbortController();
    entry.inflight = controller;
    try {
      const data = await this.fetcher(path, controller.signal);
      if (controller.signal.aborted) return;
      entry.snapshot = { data, error: undefined, updatedAt: this.now() };
    } catch (error) {
      if (controller.signal.aborted) return;
      entry.snapshot = { ...entry.snapshot, error: toApiClientError(error) };
    } finally {
      if (entry.inflight === controller) entry.inflight = null;
    }
    for (const listener of entry.listeners.keys()) listener();
  }
}

/** The store every `useApi` in the dashboard shares. */
export const apiStore = new ApiStore();
