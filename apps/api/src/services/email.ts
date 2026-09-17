import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';
import { checkHost, lookupGuardedBy, networkPolicy } from '../lib/network-guard';
import type { WebhookPayload } from './webhook';

const TIMEOUT_MS = 10_000;

export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (port 465). Otherwise STARTTLS is used when the server offers it. */
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/** True when enough is set to send — host and From are required; auth is optional (open relays on a LAN). */
export function smtpConfigured(config: SmtpConfig | null | undefined): config is SmtpConfig {
  return Boolean(config?.host && config.from);
}

/** One address, or several separated by commas or spaces. */
export function parseEmailList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** Builds a plain-text message: Subject from the alert text, body the details. */
export function emailMessage(payload: WebhookPayload): { subject: string; body: string } {
  const subject = payload.text.slice(0, 200).replace(/[\r\n]+/g, ' ');
  const lines = [
    payload.message,
    '',
    payload.monitor ? `Monitor: ${payload.monitor.name}` : null,
    payload.monitor ? `Target: ${payload.monitor.targetLabel}` : null,
    `State: ${payload.previousState} → ${payload.state}`,
    payload.value !== null ? `Value: ${payload.value}` : null,
    payload.note ? `Note: ${payload.note}` : null,
    `Time: ${payload.timestamp}`,
    '',
    '— minidog',
  ].filter((line): line is string => line !== null);
  return { subject, body: lines.join('\n') };
}

/**
 * Sends one email over SMTP. Resolves to `sent 250` (or the final reply code) or
 * `failed: …`. Never throws. Refuses blocked hosts the same way webhooks do.
 */
export async function sendEmail(
  config: SmtpConfig,
  to: string[],
  payload: WebhookPayload,
  timeoutMs: number = TIMEOUT_MS,
): Promise<string> {
  if (to.length === 0) return 'failed: no recipients';
  for (const address of to) {
    if (!isEmailAddress(address)) return `failed: invalid address ${address}`;
  }
  try {
    const { subject, body } = emailMessage(payload);
    const code = await smtpSend(config, to, subject, body, timeoutMs);
    return code >= 200 && code < 300 ? `sent ${code}` : `failed ${code}`;
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'timeout'
        : error instanceof Error
          ? error.message
          : 'error';
    return `failed: ${reason}`;
  }
}

async function smtpSend(
  config: SmtpConfig,
  to: string[],
  subject: string,
  body: string,
  timeoutMs: number,
): Promise<number> {
  const blocked = checkHost(config.host);
  if (blocked) throw blocked;

  const socket = await connect(config, timeoutMs);
  const session = new SmtpSession(socket, timeoutMs);
  try {
    await session.expect(220);
    await session.command(`EHLO minidog`, 250);
    if (!config.secure && session.offers('STARTTLS')) {
      await session.command('STARTTLS', 220);
      await session.upgrade(config.host);
      await session.command(`EHLO minidog`, 250);
    }
    if (config.user) {
      await session.command('AUTH LOGIN', 334);
      await session.command(Buffer.from(config.user).toString('base64'), 334);
      await session.command(Buffer.from(config.password).toString('base64'), 235);
    }
    await session.command(`MAIL FROM:<${envelopeAddress(config.from)}>`, 250);
    for (const address of to) await session.command(`RCPT TO:<${address}>`, 250);
    await session.command('DATA', 354);
    const message = [
      `From: ${config.from}`,
      `To: ${to.join(', ')}`,
      `Subject: ${encodeSubject(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      `Date: ${new Date().toUTCString()}`,
      '',
      dotStuff(body),
      '.',
    ].join('\r\n');
    const final = await session.data(message);
    await session.command('QUIT', 221).catch(() => undefined);
    return final;
  } finally {
    session.close();
  }
}

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match?.[1] ?? from).trim();
}

/** RFC 2047 encoded-word when the subject is not plain ASCII. */
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
}

/** Lines that begin with a dot are prefixed with another (RFC 5321). */
function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function connect(config: SmtpConfig, timeoutMs: number): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      clearTimeout(deadline);
      reject(error);
    };
    const deadline = setTimeout(() => {
      const error = new Error('timeout');
      error.name = 'TimeoutError';
      socket.destroy(error);
    }, timeoutMs);
    const options = {
      host: config.host,
      port: config.port,
      servername: config.host,
      lookup: lookupGuardedBy(() => networkPolicy.blockPrivate),
    };
    const socket = config.secure ? tlsConnect(options, done) : netConnect(options, done);
    function done() {
      clearTimeout(deadline);
      socket.off('error', onError);
      resolve(socket);
    }
    socket.once('error', onError);
  });
}

class SmtpSession {
  private buffer = '';
  private waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  private socket: Socket | TLSSocket;

  constructor(
    socket: Socket | TLSSocket,
    private readonly timeoutMs: number,
  ) {
    this.socket = socket;
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    this.socket.on('error', (error) => {
      for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    });
    this.socket.on('close', () => {
      for (const waiter of this.waiters.splice(0)) waiter.reject(new Error('connection closed'));
    });
  }

  offers(extension: string): boolean {
    return this.lastEhlo.includes(extension.toUpperCase());
  }

  private lastEhlo = '';

  async command(line: string, expectCode: number): Promise<number> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.readReply();
    if (line.startsWith('EHLO')) this.lastEhlo = reply.text.toUpperCase();
    const code = reply.code;
    if (code !== expectCode) throw new Error(`SMTP ${code}: ${reply.text.split('\r\n')[0]}`);
    return code;
  }

  async expect(code: number): Promise<void> {
    const reply = await this.readReply();
    if (reply.code !== code) throw new Error(`SMTP ${reply.code}: ${reply.text.split('\r\n')[0]}`);
  }

  async data(message: string): Promise<number> {
    this.socket.write(`${message}\r\n`);
    const reply = await this.readReply();
    if (reply.code < 200 || reply.code >= 300) throw new Error(`SMTP ${reply.code}: ${reply.text.split('\r\n')[0]}`);
    return reply.code;
  }

  upgrade(servername: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const plain = this.socket as Socket;
      const secure = tlsConnect({ socket: plain, servername }, () => {
        this.socket = secure;
        this.socket.setEncoding('utf8');
        this.socket.on('data', (chunk: string) => {
          this.buffer += chunk;
          this.flush();
        });
        resolve();
      });
      secure.on('error', reject);
    });
  }

  close(): void {
    this.socket.destroy();
  }

  private readReply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        const error = new Error('timeout');
        error.name = 'TimeoutError';
        reject(error);
      }, this.timeoutMs);
      this.waiters.push({
        resolve: (text) => {
          clearTimeout(deadline);
          resolve({ code: Number(text.slice(0, 3)), text });
        },
        reject: (error) => {
          clearTimeout(deadline);
          reject(error);
        },
      });
      this.flush();
    });
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      const end = completeReply(this.buffer);
      if (end < 0) return;
      const text = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      this.waiters.shift()!.resolve(text);
    }
  }
}

/** Index after a complete SMTP reply, or -1. A reply ends on a line `NNN ` (space, not `-`). */
function completeReply(buffer: string): number {
  let offset = 0;
  while (offset < buffer.length) {
    const next = buffer.indexOf('\n', offset);
    if (next < 0) return -1;
    const line = buffer.slice(offset, next).replace(/\r$/, '');
    if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) return next + 1;
    offset = next + 1;
  }
  return -1;
}
