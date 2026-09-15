import type { AuthStatusResponse } from '@minidog/types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { HttpError } from '../lib/errors';
import { PASSWORD_MIN_LENGTH, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '../services/auth';

/** Sent by the dashboard on every request; a cross-site form cannot add it without CORS. */
export const REQUEST_HEADER = 'x-minidog-request';

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login']);
const CHANGES_DATA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(200, 'Use at most 200 characters.');
const setupSchema = z.object({ password }).strict();
const loginSchema = z.object({ password: z.string().min(1, 'Enter the password.').max(200) }).strict();
const changeSchema = z.object({ current: z.string().min(1, 'Enter the current password.').max(200), next: password }).strict();

export function readSessionToken(request: FastifyRequest): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string, maxAge = SESSION_MAX_AGE_SECONDS): void {
  const secure = request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https';
  reply.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

/**
 * Guards the Query API: everything under /api needs a session (unless auth
 * is disabled), and requests that change data need the dashboard's header.
 * OTLP ingest (/v1/*) is authorised by API keys instead.
 */
export function authGuard(ctx: AppContext) {
  return async (request: FastifyRequest): Promise<void> => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;
    if (CHANGES_DATA.has(request.method) && request.headers[REQUEST_HEADER] !== '1') {
      throw new HttpError(403, 'missing_request_header', `Requests that change data need the ${REQUEST_HEADER} header.`);
    }
    if (ctx.auth.disabled || PUBLIC_PATHS.has(path)) return;
    if (!ctx.auth.isSignedIn(readSessionToken(request))) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  };
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { auth } = ctx;

  app.get('/api/auth/status', async (request): Promise<AuthStatusResponse> => ({
    enabled: !auth.disabled,
    setupRequired: auth.setupRequired(),
    signedIn: auth.disabled || auth.isSignedIn(readSessionToken(request)),
  }));

  app.post('/api/auth/setup', async (request, reply) => {
    const body = setupSchema.parse(request.body ?? {});
    setSessionCookie(request, reply, await auth.setup(body.password));
    return reply.status(204).send();
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body ?? {});
    setSessionCookie(request, reply, await auth.signIn(body.password));
    return reply.status(204).send();
  });

  app.post('/api/auth/logout', async (request, reply) => {
    auth.signOut(readSessionToken(request));
    setSessionCookie(request, reply, '', 0);
    return reply.status(204).send();
  });

  app.post('/api/auth/password', async (request, reply) => {
    const body = changeSchema.parse(request.body ?? {});
    await auth.changePassword(body.current, body.next, readSessionToken(request));
    return reply.status(204).send();
  });
}
