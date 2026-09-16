import http from 'node:http';
import https from 'node:https';
import type { FastifyBaseLogger } from 'fastify';
import { checkHost, guardedLookup } from '../lib/network-guard';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * minidog cannot tell you that minidog is down. This pings a service that can —
 * healthchecks.io, an Uptime Kuma push URL, or anything that notices silence —
 * so a laptop that slept, a container that died or a host that never came back
 * reaches you anyway.
 *
 * Failures are logged and retried on the next tick: the point of this timer is
 * to stay quiet, and a ping that cannot be sent is exactly what the other end
 * is watching for.
 */
export class HeartbeatPinger {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly url: string,
    private readonly intervalMs: number,
    private readonly log: FastifyBaseLogger,
  ) {}

  start(): void {
    void this.ping();
    this.timer = setInterval(() => void this.ping(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Resolves to the status code, or 0 when the ping could not be sent. */
  async ping(): Promise<number> {
    try {
      const status = await send(new URL(this.url));
      if (status >= 400) this.log.warn({ status, url: this.url }, 'Heartbeat ping was refused');
      return status;
    } catch (error) {
      this.log.warn({ err: error, url: this.url }, 'Heartbeat ping failed');
      return 0;
    }
  }
}

function send(url: URL): Promise<number> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return reject(new Error(`Unsupported protocol ${url.protocol}`));
    const blocked = checkHost(url.hostname);
    if (blocked) return reject(blocked);

    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, { method: 'GET', lookup: guardedLookup }, (response) => {
      clearTimeout(deadline);
      resolve(response.statusCode ?? 0);
      // Only the status matters; the body is not read.
      response.destroy();
    });
    const deadline = setTimeout(() => {
      const error = new Error('timeout');
      error.name = 'TimeoutError';
      request.destroy(error);
    }, REQUEST_TIMEOUT_MS);
    request.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    request.end();
  });
}
