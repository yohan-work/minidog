import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { test } from 'node:test';
import { emailMessage, isEmailAddress, parseEmailList, sendEmail, smtpConfigured, type SmtpConfig } from './email';
import { testWebhookPayload } from './webhook';

test('parses and validates address lists', () => {
  assert.deepEqual(parseEmailList('a@b.co, c@d.co  e@f.co'), ['a@b.co', 'c@d.co', 'e@f.co']);
  assert.equal(isEmailAddress('a@b.co'), true);
  assert.equal(isEmailAddress('not-an-email'), false);
  assert.equal(smtpConfigured(null), false);
  assert.equal(smtpConfigured({ host: '', port: 25, secure: false, user: '', password: '', from: 'a@b.co' }), false);
  assert.equal(
    smtpConfigured({ host: 'smtp.example', port: 587, secure: false, user: '', password: '', from: 'a@b.co' }),
    true,
  );
});

test('the email body is plain text with the monitor and state', () => {
  const { subject, body } = emailMessage({
    ...testWebhookPayload(),
    text: '[CRITICAL] P95 · api: P95 1.5 s ≥ critical 1 s (last 5 min)',
    state: 'critical',
    previousState: 'ok',
    message: 'P95 1.5 s ≥ critical 1 s (last 5 min)',
    monitor: { id: 'alm_1', name: 'P95 · api', type: 'latency', target: 'api', targetLabel: 'api' },
    value: 1500,
  });
  assert.match(subject, /^\[CRITICAL\]/);
  assert.match(body, /Monitor: P95 · api/);
  assert.match(body, /State: ok → critical/);
  assert.match(body, /Value: 1500/);
});

/** A tiny SMTP server that records what the client sent and answers OK. */
async function withSmtp(run: (config: SmtpConfig) => Promise<string>): Promise<{ status: string; transcript: string }> {
  const transcript: string[] = [];
  let authStep = 0;
  let inData = false;
  const server: Server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 test.local ready\r\n');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      while (true) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        transcript.push(line);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 OK\r\n');
          }
          continue;
        }
        if (/^EHLO /i.test(line)) socket.write('250-test.local\r\n250 AUTH LOGIN\r\n');
        else if (/^AUTH LOGIN$/i.test(line)) {
          authStep = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (authStep === 1) {
          authStep = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (authStep === 2) {
          authStep = 0;
          socket.write('235 OK\r\n');
        } else if (/^MAIL FROM:/i.test(line) || /^RCPT TO:/i.test(line)) socket.write('250 OK\r\n');
        else if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write('354 Go ahead\r\n');
        } else if (/^QUIT$/i.test(line)) {
          socket.write('221 Bye\r\n');
          socket.end();
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const status = await run({
      host: '127.0.0.1',
      port: address.port,
      secure: false,
      user: 'user',
      password: 'pass',
      from: 'minidog@example.com',
    });
    return { status, transcript: transcript.join('\n') };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('sendEmail delivers through SMTP AUTH LOGIN and returns sent 250', async () => {
  const { status, transcript } = await withSmtp((config) =>
    sendEmail(config, ['oncall@example.com'], testWebhookPayload()),
  );
  assert.equal(status, 'sent 250');
  assert.match(transcript, /EHLO minidog/);
  assert.match(transcript, /AUTH LOGIN/);
  assert.match(transcript, /MAIL FROM:<minidog@example.com>/);
  assert.match(transcript, /RCPT TO:<oncall@example.com>/);
  assert.match(transcript, /Subject: \[TEST\]/);
  assert.match(transcript, /To: oncall@example.com/);
});

test('sendEmail refuses an empty recipient list without connecting', async () => {
  const status = await sendEmail(
    { host: '127.0.0.1', port: 1, secure: false, user: '', password: '', from: 'a@b.co' },
    [],
    testWebhookPayload(),
  );
  assert.equal(status, 'failed: no recipients');
});
