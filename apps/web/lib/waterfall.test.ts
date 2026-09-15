import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SpanDetail } from '@minidog/types';
import { buildWaterfall, selfTime } from './waterfall';

const span = (
  spanId: string,
  parentSpanId: string,
  startMs: number,
  durationMs: number,
  name = spanId,
): SpanDetail => ({
  spanId,
  parentSpanId,
  service: 'api',
  host: '',
  name,
  kind: 'internal',
  startMs,
  durationMs,
  status: 'unset',
  statusMessage: '',
  httpMethod: '',
  httpRoute: '',
  httpStatus: null,
  dbSystem: '',
  attributes: {},
  resourceAttributes: {},
  events: [],
});

test('orders spans depth-first by start time', () => {
  const model = buildWaterfall([
    span('db', 'root', 20, 30),
    span('root', '', 0, 100),
    span('auth', 'root', 5, 10),
    span('payment', 'root', 60, 30),
  ]);
  assert.deepEqual(
    model.rows.map((row) => [row.span.spanId, row.depth]),
    [
      ['root', 0],
      ['auth', 1],
      ['db', 1],
      ['payment', 1],
    ],
  );
  assert.equal(model.durationMs, 100);
  assert.equal(model.rows[2]?.offsetPct, 20);
});

test('spans whose parent is missing become roots', () => {
  const model = buildWaterfall([span('a', 'missing', 10, 5), span('b', '', 0, 20)]);
  assert.deepEqual(
    model.rows.map((row) => [row.span.spanId, row.depth]),
    [
      ['b', 0],
      ['a', 0],
    ],
  );
  assert.equal(model.startMs, 0);
});

test('self time subtracts overlapping children once and ignores time outside the span', () => {
  const parent = span('p', '', 0, 100);
  const children = [
    span('c1', 'p', 10, 30), // 10–40
    span('c2', 'p', 30, 20), // 30–50, overlaps c1
    span('c3', 'p', 90, 40), // 90–130, only 10 ms inside
  ];
  // Covered: 10–50 and 90–100 → 50 ms.
  assert.equal(selfTime(parent, children), 50);
  assert.equal(selfTime(parent, []), 100);
});

test('the slowest span is the one with the most self time, not the longest', () => {
  // POST /checkout 757 ms, most of it waiting on postgres.query (580 ms).
  const model = buildWaterfall([
    span('request', '', 0, 757, 'POST /checkout'),
    span('auth', 'request', 5, 40),
    span('query', 'request', 60, 580, 'postgres.query'),
    span('payment', 'request', 650, 90),
  ]);
  assert.equal(model.slowestSpanId, 'query');
});

test('a single span has no slowest span to point at', () => {
  assert.equal(buildWaterfall([span('only', '', 0, 12)]).slowestSpanId, null);
});
