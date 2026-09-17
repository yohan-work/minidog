import { HEARTBEAT_PATH } from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { HttpError } from '../lib/errors';

const paramsSchema = z.object({ token: z.string().min(1).max(255) });

/** Pings are tiny; anything larger is not a ping. */
const MAX_PING_BODY_BYTES = 64 * 1024;

/**
 * `GET|POST /heartbeat/:token` — a cron job or backup script checking in.
 * Outside `/api/`, so it needs neither the session nor the request header, and
 * it accepts any body (or none): `curl` with or without `-d` both work. The
 * token is the credential; a wrong one is 404 like any other unknown URL.
 */
export function registerHeartbeatRoutes(app: FastifyInstance, ctx: AppContext): void {
  void app.register(async (pings) => {
    pings.removeAllContentTypeParsers();
    pings.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_PING_BODY_BYTES }, (_request, _body, done) =>
      done(null, undefined),
    );
    pings.route({
      method: ['GET', 'POST'],
      url: `${HEARTBEAT_PATH}/:token`,
      handler: async (request) => {
        const { token } = paramsSchema.parse(request.params);
        const monitor = await ctx.alerting.ping(token);
        if (!monitor) throw new HttpError(404, 'not_found', 'No heartbeat monitor has this token.');
        return { status: 'ok', receivedAt: monitor.heartbeat?.lastPingAt ?? new Date().toISOString() };
      },
    });
  });
}
