import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOtlpLogs, severityNumber, toLevel } from './otlp-logs';

const scope = { projectId: 'prj_1', environment: 'production' };
const now = Date.UTC(2026, 8, 14, 12, 0, 0);
const nanos = (ms: number) => String(BigInt(ms) * 1_000_000n);
const str = (key: string, value: string) => ({ key, value: { stringValue: value } });

test('maps log records with trace context', () => {
  const { rows } = parseOtlpLogs(
    {
      resourceLogs: [
        {
          resource: { attributes: [str('service.name', 'api')] },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: nanos(now + 124),
                  severityNumber: 17,
                  severityText: 'ERROR',
                  body: { stringValue: 'payment request failed' },
                  attributes: [str('route', '/checkout')],
                  traceId: '5b8efff798038103d269b633813fc60c',
                  spanId: 'eee19b7ec3c1b174',
                },
              ],
            },
          ],
        },
      ],
    },
    scope,
    now,
  );

  assert.deepEqual(rows[0], {
    project_id: 'prj_1',
    environment: 'production',
    service: 'api',
    host: '',
    resource_attributes: { 'service.name': 'api' },
    timestamp: '2026-09-14 12:00:00.124000',
    level: 'error',
    severity_text: 'ERROR',
    severity_number: 17,
    body: 'payment request failed',
    trace_id: '5b8efff798038103d269b633813fc60c',
    span_id: 'eee19b7ec3c1b174',
    attributes: { route: '/checkout' },
  });
});

test('falls back to observed time, then receive time; structured bodies become JSON', () => {
  const { rows } = parseOtlpLogs(
    {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                { observedTimeUnixNano: nanos(now - 1000), body: { kvlistValue: { values: [str('user', 'u1')] } } },
                { severityText: 'warning' },
              ],
            },
          ],
        },
      ],
    },
    scope,
    now,
  );
  assert.equal(rows[0]?.timestamp, '2026-09-14 11:59:59.000000');
  assert.equal(rows[0]?.body, '{"user":"u1"}');
  assert.equal(rows[0]?.level, 'info');
  assert.equal(rows[1]?.timestamp, '2026-09-14 12:00:00.000000');
  assert.equal(rows[1]?.level, 'warn');
  assert.equal(rows[1]?.trace_id, '');
});

test('severity numbers and names map to levels', () => {
  assert.equal(severityNumber('SEVERITY_NUMBER_WARN2'), 14);
  assert.equal(severityNumber('SEVERITY_NUMBER_FATAL'), 21);
  assert.equal(severityNumber('13'), 13);
  assert.equal(severityNumber(99), 0);
  assert.equal(toLevel(1, ''), 'trace');
  assert.equal(toLevel(9, ''), 'info');
  assert.equal(toLevel(24, ''), 'fatal');
  assert.equal(toLevel(0, 'CRITICAL'), 'fatal');
  assert.equal(toLevel(0, 'nonsense'), 'info');
});
