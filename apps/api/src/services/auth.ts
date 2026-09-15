import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../lib/errors';
import type { AuthRepository } from '../repositories/auth-repository';

export const SESSION_COOKIE = 'minidog_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const PASSWORD_MIN_LENGTH = 8;

const SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 64 };
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 5 * 60_000;

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number; keyLength: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, params.keyLength, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** `scrypt$N$r$p$salt$hash`, base64 parts; the parameters travel with the hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(r), p: Number(p), keyLength: expected.length });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Only hashes of session tokens are stored, so a copy of the database opens no session. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * One password protects the dashboard and its Query API (OTLP ingest has API
 * keys). It is chosen on first run; sessions last 30 days.
 */
export class AuthService {
  private readonly failures = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly store: AuthRepository,
    /** AUTH_DISABLED: only for a machine nobody else can reach. */
    readonly disabled: boolean,
  ) {}

  setupRequired(): boolean {
    return !this.disabled && this.store.passwordHash() === null;
  }

  isSignedIn(token: string | undefined): boolean {
    if (!token) return false;
    const expiry = this.store.sessionExpiry(hashToken(token));
    return expiry !== undefined && Date.parse(expiry) > Date.now();
  }

  /** First run: sets the password and signs in. */
  async setup(password: string): Promise<string> {
    if (this.store.passwordHash() !== null) throw new HttpError(409, 'already_set_up', 'A password is already set. Sign in instead.');
    this.store.setPasswordHash(await hashPassword(password));
    return this.startSession();
  }

  async signIn(password: string, client: string): Promise<string> {
    this.checkThrottle(client);
    const stored = this.store.passwordHash();
    if (stored === null) throw new HttpError(409, 'setup_required', 'Set a password first.');
    if (!(await verifyPassword(stored, password))) {
      this.recordFailure(client);
      throw new HttpError(401, 'invalid_password', 'That password is not right.');
    }
    this.failures.delete(client);
    return this.startSession();
  }

  signOut(token: string | undefined): void {
    if (token) this.store.deleteSession(hashToken(token));
  }

  /** Signs out every other session. */
  async changePassword(current: string, next: string, token: string | undefined): Promise<void> {
    const stored = this.store.passwordHash();
    if (stored === null || !(await verifyPassword(stored, current))) throw new HttpError(401, 'invalid_password', 'The current password is not right.');
    this.store.setPasswordHash(await hashPassword(next));
    this.store.deleteOtherSessions(token ? hashToken(token) : null);
  }

  private startSession(): string {
    const token = randomBytes(32).toString('base64url');
    this.store.deleteExpired();
    this.store.createSession(hashToken(token), new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString());
    return token;
  }

  private checkThrottle(client: string): void {
    const entry = this.failures.get(client);
    if (!entry) return;
    if (Date.now() - entry.firstAt > FAILURE_WINDOW_MS) this.failures.delete(client);
    else if (entry.count >= MAX_FAILURES) throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Try again in a few minutes.');
  }

  private recordFailure(client: string): void {
    const entry = this.failures.get(client);
    if (!entry || Date.now() - entry.firstAt > FAILURE_WINDOW_MS) this.failures.set(client, { count: 1, firstAt: Date.now() });
    else entry.count += 1;
  }
}
