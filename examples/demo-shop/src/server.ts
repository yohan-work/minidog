import { createServer, type IncomingMessage } from 'node:http';
import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { log, type ServiceResponse } from './telemetry';

export interface Route {
  method: 'GET' | 'POST';
  /** Route template, e.g. `/orders/:id`; recorded as `http.route`. */
  route: string;
  handler: (request: { params: Record<string, string>; body: unknown }) => Promise<ServiceResponse>;
}

export interface Control {
  /** Untraced `/__demo/scenario` endpoint. */
  onScenario: (body: unknown) => Promise<unknown>;
}

/** HTTP server whose requests are server spans continuing the caller's trace. */
export function serve(service: string, port: number, routes: readonly Route[], control: Control): void {
  const tracer = trace.getTracer(service);

  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (url.pathname === '/__demo/scenario') {
      const body = method === 'POST' ? await readJson(req) : undefined;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await control.onScenario(body)));
      return;
    }

    const match = matchRoute(routes, method, url.pathname);
    const name = match ? `${method} ${match.route.route}` : method;
    const parent = propagation.extract(context.active(), req.headers);

    await tracer.startActiveSpan(
      name,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': method,
          'url.path': url.pathname,
          ...(match ? { 'http.route': match.route.route } : {}),
        },
      },
      parent,
      async (span) => {
        let response: ServiceResponse = { status: 404, body: { error: 'Not found' } };
        try {
          if (match) response = await match.route.handler({ params: match.params, body: await readJson(req) });
        } catch (error) {
          const message = (error as Error).message;
          span.recordException(error as Error);
          log('error', `${name} failed: ${message}`, { 'http.route': match?.route.route ?? url.pathname });
          response = { status: 500, body: { error: message } };
        }
        span.setAttribute('http.response.status_code', response.status);
        if (response.status >= 500) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String((response.body as { error?: string } | null)?.error ?? ''),
          });
        }
        res.writeHead(response.status, { 'content-type': 'application/json' }).end(JSON.stringify(response.body));
        span.end();
      },
    );
  }).listen(port, '127.0.0.1', () => {
    console.log(`${service} listening on http://127.0.0.1:${port}`);
  });
}

function matchRoute(routes: readonly Route[], method: string, path: string) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const expected = route.route.split('/');
    const actual = path.split('/');
    if (expected.length !== actual.length) continue;
    const params: Record<string, string> = {};
    const matches = expected.every((segment, index) => {
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = actual[index] ?? '';
        return true;
      }
      return segment === actual[index];
    });
    if (matches) return { route, params };
  }
  return null;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}
