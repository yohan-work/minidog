import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOtlpTraces } from './otlp-traces';

const scope = { projectId: 'prj_1', environment: 'production' };
const start = Date.UTC(2026, 8, 14, 12, 0, 0);
const nanos = (ms: number) => String(BigInt(ms) * 1_000_000n);
const str = (key: string, value: string) => ({ key, value: { stringValue: value } });
const int = (key: string, value: number) => ({ key, value: { intValue: String(value) } });

const TRACE = '5b8efff798038103d269b633813fc60c';

const request = {
  resourceSpans: [
    {
      resource: { attributes: [str('service.name', 'api'), str('host.name', 'web-1')] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: TRACE,
              spanId: 'eee19b7ec3c1b174',
              name: 'POST /checkout',
              kind: 2,
              startTimeUnixNano: nanos(start),
              endTimeUnixNano: String(BigInt(start) * 1_000_000n + 757_250_000n),
              attributes: [str('http.request.method', 'POST'), str('http.route', '/checkout'), int('http.response.status_code', 500)],
              events: [{ timeUnixNano: nanos(start + 700), name: 'exception', attributes: [str('exception.message', 'boom')] }],
              status: { code: 2, message: 'payment failed' },
            },
            {
              traceId: TRACE,
              spanId: 'eee19b7ec3c1b175',
              parentSpanId: 'eee19b7ec3c1b174',
              name: 'postgres.query',
              kind: 'SPAN_KIND_CLIENT',
              startTimeUnixNano: nanos(start + 100),
              endTimeUnixNano: nanos(start + 680),
              attributes: [str('db.system', 'postgresql')],
            },
            { traceId: TRACE, name: 'no span id', startTimeUnixNano: nanos(start) },
          ],
        },
      ],
    },
  ],
};

test('maps server spans to entry rows with HTTP columns and errors', () => {
  const { rows, rejected } = parseOtlpTraces(request, scope);
  assert.equal(rows.length, 2);
  assert.equal(rejected, 1);

  const [server] = rows;
  assert.equal(server?.timestamp, '2026-09-14 12:00:00.000000');
  assert.equal(server?.service, 'api');
  assert.equal(server?.host, 'web-1');
  assert.equal(server?.kind, 'server');
  assert.equal(server?.duration_ms, 757.25);
  assert.equal(server?.http_status, 500);
  assert.equal(server?.endpoint, 'POST /checkout');
  assert.equal(server?.is_entry, 1);
  assert.equal(server?.is_error, 1);
  assert.equal(server?.status_message, 'payment failed');
  assert.deepEqual(JSON.parse(server?.events ?? '[]'), [
    { timeUnixMs: start + 700, name: 'exception', attributes: { 'exception.message': 'boom' } },
  ]);
});

test('child client spans are not entries and carry the database system', () => {
  const child = parseOtlpTraces(request, scope).rows[1];
  assert.equal(child?.parent_span_id, 'eee19b7ec3c1b174');
  assert.equal(child?.kind, 'client');
  assert.equal(child?.db_system, 'postgresql');
  assert.equal(child?.is_entry, 0);
  assert.equal(child?.is_error, 0);
  assert.equal(child?.endpoint, '');
  assert.equal(child?.timestamp, '2026-09-14 12:00:00.100000');
});

test('accepts base64 ids and legacy HTTP attribute names', () => {
  const traceId = Buffer.from(TRACE, 'hex').toString('base64');
  const spanId = Buffer.from('eee19b7ec3c1b174', 'hex').toString('base64');
  const { rows } = parseOtlpTraces(
    {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId,
                  spanId,
                  name: 'GET',
                  kind: 1,
                  startTimeUnixNano: nanos(start),
                  attributes: [str('http.method', 'GET'), str('http.route', '/items/:id'), int('http.status_code', 200)],
                },
              ],
            },
          ],
        },
      ],
    },
    scope,
  );
  assert.equal(rows[0]?.trace_id, TRACE);
  assert.equal(rows[0]?.span_id, 'eee19b7ec3c1b174');
  assert.equal(rows[0]?.is_entry, 1, 'root spans count as entries');
  assert.equal(rows[0]?.endpoint, 'GET /items/:id');
  assert.equal(rows[0]?.duration_ms, 0);
});

test('rejects bodies that are not OTLP trace requests', () => {
  assert.throws(() => parseOtlpTraces({ resourceSpans: 'x' }, scope), /OTLP/);
});
