import type { NextRequest } from 'next/server';

/**
 * The browser talks to the Query API through the dashboard's origin (no CORS,
 * same-site cookies). Unlike a next.config rewrite, which is fixed at build
 * time, this reads API_URL when a request arrives, so one image works with
 * any API address.
 */
export const dynamic = 'force-dynamic';

const DEFAULT_API_URL = 'http://127.0.0.1:4000';
// Connection-level headers describe this hop, not the request.
const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'host', 'content-length'];

async function forward(request: NextRequest): Promise<Response> {
  const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, process.env.API_URL || DEFAULT_API_URL);
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  headers.set('x-forwarded-host', request.headers.get('host') ?? '');

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // Streams the request body instead of buffering it.
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
      signal: request.signal,
    } as RequestInit);
  } catch {
    return Response.json({ error: { code: 'api_unavailable', message: 'The Query API did not respond.' } }, { status: 502 });
  }

  const response = new Headers(upstream.headers);
  // fetch has already decoded the body.
  for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) response.delete(name);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: response });
}

export { forward as DELETE, forward as GET, forward as HEAD, forward as PATCH, forward as POST, forward as PUT };
