import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { TLSSocket } from 'node:tls';
import type { CheckStatus, HttpMethod } from '@minidog/types';
import { checkHost, guardedLookup } from '../lib/network-guard';
import { formatExpectedStatus, matchesStatus, type StatusMatcher } from './expected-status';

const MAX_BODY_BYTES = 1024 * 1024;
const USER_AGENT = 'minidog-synthetics/0.2';
/** Hops followed before a chain counts as a redirect loop. */
export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface HttpCheckTarget {
  url: string;
  method: HttpMethod;
  /** For the whole check, redirects included. */
  timeoutMs: number;
  expectedStatus: StatusMatcher;
  /** Follow 3xx responses (up to MAX_REDIRECTS); the final response is judged. */
  followRedirects?: boolean;
  /** Text the response body must contain (first 1 MB, case-sensitive); '' skips the check. */
  bodyContains?: string;
}

export interface HttpCheckResult {
  startedAt: Date;
  status: CheckStatus;
  /** Of the final response; 0 when no response was received. */
  statusCode: number;
  /** Total time until the final body was read (or the check failed), redirects included. */
  latencyMs: number;
  /** Connection timings are those of the final request. */
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  /**
   * The first certificate presented: the monitored host's own, or for an
   * http:// URL the one it redirects to. A later hop on another host must not
   * hide an expiring certificate on the monitored one.
   */
  sslExpiresAt: Date | null;
  /** Empty when the check passed. */
  error: string;
  /** Redirects followed. */
  redirects: number;
  /** URL of the final request. */
  finalUrl: string;
}

/** One request/response on a fresh connection. */
interface Hop {
  statusCode: number;
  location: string | null;
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  sslExpiresAt: Date | null;
  body: string;
  bodyTruncated: boolean;
  error: string;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

const failedHop = (error: string): Hop => ({
  statusCode: 0,
  location: null,
  dnsMs: null,
  connectMs: null,
  tlsMs: null,
  ttfbMs: null,
  sslExpiresAt: null,
  body: '',
  bodyTruncated: false,
  error,
});

function parseHttpUrl(value: string, base?: URL): URL {
  const url = new URL(value, base);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported protocol ${url.protocol}`);
  return url;
}

/**
 * Performs a check on fresh connections so DNS, TCP and TLS timings are
 * measured every time. With `followRedirects` 3xx responses are followed and
 * the final response is evaluated; otherwise a 3xx is judged against the
 * expected status like any other code. Never rejects.
 */
export async function performHttpCheck(target: HttpCheckTarget): Promise<HttpCheckResult> {
  const startedAt = new Date();
  const t0 = performance.now();
  const deadline = t0 + target.timeoutMs;
  const timeoutMessage = `Timed out after ${target.timeoutMs} ms`;
  const expected = target.bodyContains ?? '';
  const readBody = expected !== '' && target.method !== 'HEAD';
  let redirects = 0;
  let firstCertificate: Date | null = null;

  const finish = (hop: Hop, url: string, failure = ''): HttpCheckResult => {
    let error = failure || hop.error;
    let passed = error === '' && matchesStatus(target.expectedStatus, hop.statusCode);
    if (!error && !passed)
      error = `Expected status ${formatExpectedStatus(target.expectedStatus)}, got ${hop.statusCode}`;
    if (passed && readBody && !hop.body.includes(expected)) {
      passed = false;
      error = `Response body does not contain "${expected}"${hop.bodyTruncated ? ' (in the first 1 MB)' : ''}`;
    }
    return {
      startedAt,
      status: passed ? 'up' : 'down',
      statusCode: hop.statusCode,
      latencyMs: round(performance.now() - t0),
      dnsMs: hop.dnsMs,
      connectMs: hop.connectMs,
      tlsMs: hop.tlsMs,
      ttfbMs: hop.ttfbMs,
      sslExpiresAt: firstCertificate ?? hop.sslExpiresAt,
      error: passed ? '' : error,
      redirects,
      finalUrl: url,
    };
  };

  let url: URL;
  try {
    url = parseHttpUrl(target.url);
  } catch (error) {
    return finish(failedHop(error instanceof Error ? error.message : 'Invalid URL'), target.url);
  }

  for (;;) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return finish(failedHop(timeoutMessage), url.toString());
    // Every hop, redirects included: an IP literal connects without the guarded DNS lookup.
    const blocked = checkHost(url.hostname);
    if (blocked) return finish(failedHop(blocked.message), url.toString());
    const hop = await requestOnce(url, target.method, remaining, readBody, timeoutMessage);
    firstCertificate ??= hop.sslExpiresAt;

    const redirected =
      target.followRedirects && hop.error === '' && REDIRECT_STATUSES.has(hop.statusCode) && hop.location;
    if (!redirected) return finish(hop, url.toString());
    if (redirects >= MAX_REDIRECTS)
      return finish(hop, url.toString(), `Too many redirects (more than ${MAX_REDIRECTS})`);

    let next: URL;
    try {
      next = parseHttpUrl(hop.location!, url);
    } catch {
      return finish(hop, url.toString(), `Invalid redirect location "${hop.location}"`);
    }
    // GET and HEAD stay as they are on every redirect status, including 303.
    url = next;
    redirects += 1;
  }
}

function requestOnce(
  url: URL,
  method: HttpMethod,
  timeoutMs: number,
  readBody: boolean,
  timeoutMessage: string,
): Promise<Hop> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const marks: { lookup?: number; connect?: number; secureConnect?: number; response?: number } = {};
    let statusCode = 0;
    let location: string | null = null;
    let sslExpiresAt: Date | null = null;
    const chunks: Buffer[] = [];
    let received = 0;
    let truncated = false;
    let settled = false;
    let request: http.ClientRequest | undefined;

    const span = (from: number | undefined, to: number | undefined): number | null =>
      from === undefined || to === undefined ? null : round(to - from);

    const settle = (error: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        statusCode,
        location,
        dnsMs: span(t0, marks.lookup),
        connectMs: span(marks.lookup ?? t0, marks.connect),
        tlsMs: span(marks.connect, marks.secureConnect),
        ttfbMs: span(t0, marks.response),
        sslExpiresAt,
        body: readBody ? Buffer.concat(chunks).toString('utf8') : '',
        bodyTruncated: truncated,
        error,
      });
      request?.destroy();
    };

    const timer = setTimeout(() => settle(timeoutMessage), timeoutMs);
    const client = url.protocol === 'https:' ? https : http;
    try {
      request = client.request(url, {
        method,
        agent: false,
        lookup: guardedLookup,
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      });
    } catch (error) {
      settle(describeError(error as NodeJS.ErrnoException));
      return;
    }

    request.on('socket', (socket: Socket) => {
      socket.once('lookup', () => {
        marks.lookup = performance.now();
      });
      socket.once('connect', () => {
        marks.connect = performance.now();
      });
      socket.once('secureConnect', () => {
        marks.secureConnect = performance.now();
        const certificate = (socket as TLSSocket).getPeerCertificate();
        const expiry = certificate?.valid_to ? new Date(certificate.valid_to) : null;
        if (expiry && !Number.isNaN(expiry.getTime())) sslExpiresAt = expiry;
      });
    });

    request.on('response', (response) => {
      marks.response = performance.now();
      statusCode = response.statusCode ?? 0;
      location = typeof response.headers.location === 'string' ? response.headers.location : null;
      response.on('data', (chunk: Buffer) => {
        if (readBody)
          chunks.push(received + chunk.length > MAX_BODY_BYTES ? chunk.subarray(0, MAX_BODY_BYTES - received) : chunk);
        received += chunk.length;
        if (received >= MAX_BODY_BYTES) {
          truncated = true;
          settle('');
        }
      });
      response.on('end', () => settle(''));
      response.on('error', (error) => settle(describeError(error)));
    });

    request.on('error', (error) => settle(describeError(error)));
    request.end();
  });
}

function describeError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case 'EBLOCKED':
      return error.message;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `DNS lookup failed (${error.code})`;
    case 'ECONNREFUSED':
      return 'Connection refused (ECONNREFUSED)';
    case 'ECONNRESET':
      return 'Connection reset by peer (ECONNRESET)';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Host unreachable (${error.code})`;
    case 'CERT_HAS_EXPIRED':
      return 'TLS certificate has expired (CERT_HAS_EXPIRED)';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return `TLS certificate is self-signed (${error.code})`;
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'TLS certificate does not match host (ERR_TLS_CERT_ALTNAME_INVALID)';
    default:
      return error.code ? `${error.message} (${error.code})` : error.message;
  }
}
