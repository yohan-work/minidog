import { hostname } from 'node:os';
import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';

/** A lock refreshed less recently than this belongs to an API that is gone. */
export const LOCK_STALE_MS = 30_000;
const HEARTBEAT_MS = 10_000;

interface LockOwner {
  pid: number;
  host: string;
  startedAt: string;
}

export class DataLockedError extends Error {
  constructor(
    readonly lockPath: string,
    readonly owner: LockOwner | null,
  ) {
    const who = owner ? `process ${owner.pid} on ${owner.host}, since ${owner.startedAt}` : 'another process';
    super(
      `The data at ${lockPath.replace(/\.lock$/, '')} is in use by ${who}. ` +
        'Run one minidog at a time: stop the other one (`pnpm local:down` for always-on mode). ' +
        `If none is running, the lock expires ${LOCK_STALE_MS / 1000} s after it was last refreshed.`,
    );
  }
}

/**
 * Claims the SQLite file for this process: `pnpm dev` and the always-on
 * containers share it through a bind mount, where SQLite's own locking cannot
 * be trusted across the VM boundary. The lock file is refreshed while the API
 * runs, so a crashed owner (whose pid another machine cannot check) expires.
 */
export function acquireDataLock(sqlitePath: string, now: () => number = Date.now): { release: () => void } {
  const lockPath = `${sqlitePath}.lock`;
  const owner: LockOwner = { pid: process.pid, host: hostname(), startedAt: new Date(now()).toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, JSON.stringify(owner), { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = readOwner(lockPath);
      if (attempt === 0 && isStale(lockPath, current, now())) {
        rmSync(lockPath, { force: true });
        continue;
      }
      throw new DataLockedError(lockPath, current);
    }
  }

  const heartbeat = setInterval(() => {
    const at = new Date(now());
    try {
      utimesSync(lockPath, at, at);
    } catch {
      // Removed by hand; the API keeps running.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    release: () => {
      clearInterval(heartbeat);
      if (readOwner(lockPath)?.pid === owner.pid && readOwner(lockPath)?.host === owner.host)
        rmSync(lockPath, { force: true });
    },
  };
}

function readOwner(lockPath: string): LockOwner | null {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8')) as LockOwner;
  } catch {
    return null;
  }
}

function isStale(lockPath: string, owner: LockOwner | null, nowMs: number): boolean {
  // On this machine a dead pid settles it at once.
  if (owner && owner.host === hostname() && !isAlive(owner.pid)) return true;
  try {
    return nowMs - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
