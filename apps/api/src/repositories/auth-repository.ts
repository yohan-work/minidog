import type { DatabaseSync } from 'node:sqlite';

const PASSWORD_KEY = 'auth_password';

/** The single dashboard password (as a hash) and the sessions it opened. */
export class AuthRepository {
  constructor(private readonly db: DatabaseSync) {}

  passwordHash(): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(PASSWORD_KEY) as unknown as { value: string } | undefined;
    return row?.value ?? null;
  }

  /** First run: stores the password only if there is none yet. False when one already exists. */
  insertPasswordHash(hash: string): boolean {
    const result = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(PASSWORD_KEY, hash);
    return Number(result.changes) > 0;
  }

  setPasswordHash(hash: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(PASSWORD_KEY, hash);
  }

  createSession(tokenHash: string, expiresAt: string): void {
    this.db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(tokenHash, new Date().toISOString(), expiresAt);
  }

  /** Expiry (ISO) of a session, or undefined when there is none. */
  sessionExpiry(tokenHash: string): string | undefined {
    const row = this.db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as unknown as { expires_at: string } | undefined;
    return row?.expires_at;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  /** Signs out everywhere except, optionally, one session. */
  deleteOtherSessions(keepTokenHash: string | null): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash != ?').run(keepTokenHash ?? '');
  }

  deleteExpired(now: string = new Date().toISOString()): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }

  /** Forgets the password and every session; the next visit sets a new password. */
  reset(): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(PASSWORD_KEY);
    this.db.prepare('DELETE FROM sessions').run();
  }
}
