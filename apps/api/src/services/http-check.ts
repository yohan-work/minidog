import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { TLSSocket } from 'node:tls';
import type { CheckStatus, HttpMethod } from '@minidog/types';
import { formatExpectedStatus, matchesStatus, type StatusMatcher } from './expected-status';

const MAX_BODY_BYTES = 1024 * 1024;
const USER_AGENT = 'minidog-synthetics/0.1';

export interface HttpCheckTarget {
  url: string;
  method: HttpMethod;
  timeoutMs: number;
  expectedStatus: StatusMatcher;
}

export interface HttpCheckResult {
  startedAt: Date;
  status: CheckStatus;
  /** 0 when no response was received. */
  statusCode: number;
  /** Total time until the body was read (or the check failed). */
  latencyMs: number;
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  sslExpiresAt: Date | null;
  /** Empty when the check passed. */
  error: string;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

/**
 * Performs a single HTTP check on a fresh connection so DNS, TCP and TLS
 * timings are measured every time. Redirects are not followed; a 3xx is
 * evaluated against the expected status like any other code. Never rejects.
 */
export function performHttpCheck(target: HttpCheckTarget): Promise<HttpCheckResult> {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const t0 = performance.now();
    const marks: { lookup?: number; connect?: number; secureConnect?: number; response?: number } = {};
    let statusCode = 0;
    let sslExpiresAt: Date | null = null;
    let settled = false;
    let request: http.ClientRequest | undefined;
    let timer: NodeJS.Timeout | undefined;

    const span = (from: number | undefined, to: number | undefined): number | null =>
      from === undefined || to === undefined ? null : round(to - from);

    const settle = (failure: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const end = performance.now();
      const passed = failure === '' && matchesStatus(target.expectedStatus, statusCode);
      resolve({
        startedAt,
        status: passed ? 'up' : 'down',
        statusCode,
        latencyMs: round(end - t0),
        dnsMs: span(t0, marks.lookup),
        connectMs: span(marks.lookup ?? t0, marks.connect),
        tlsMs: span(marks.connect, marks.secureConnect),
        ttfbMs: span(t0, marks.response),
        sslExpiresAt,
        error: passed
          ? ''
          : failure || `Expected status ${formatExpectedStatus(target.expectedStatus)}, got ${statusCode}`,
      });
      request?.destroy();
    };

    let url: URL;
    try {
      url = new URL(target.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported protocol ${url.protocol}`);
    } catch (error) {
      settle(error instanceof Error ? error.message : 'Invalid URL');
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    request = client.request(url, {
      method: target.method,
      agent: false,
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    });
    timer = setTimeout(() => settle(`Timed out after ${target.timeoutMs} ms`), target.timeoutMs);

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
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received >= MAX_BODY_BYTES) settle('');
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
