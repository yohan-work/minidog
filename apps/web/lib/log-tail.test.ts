import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LogEntry } from '@minidog/types';
import { mergeTail, TAIL_BUFFER } from './log-tail';

const log = (timestamp: number, body = `at ${timestamp}`): LogEntry => ({
  timestamp,
  service: 'api',
  host: '',
  level: 'info',
  severityText: 'INFO',
  body,
  traceId: '',
  spanId: '',
  attributes: {},
});
const times = (logs: readonly LogEntry[]) => logs.map((entry) => entry.timestamp);

test('a poll replaces the overlapped part of the buffer without duplicates', () => {
  const buffer = [log(120), log(110), log(100), log(90)];
  // Re-reads from 100: 100–120 again, plus a late record at 105 and a new one at 130.
  const merged = mergeTail(buffer, [log(130), log(120), log(110), log(105), log(100)], 100, false);
  assert.deepEqual(times(merged), [130, 120, 110, 105, 100, 90]);
});

test('a truncated poll only replaces records from its oldest one', () => {
  const buffer = [log(120), log(110), log(100)];
  const merged = mergeTail(buffer, [log(140), log(130)], 100, true);
  assert.deepEqual(times(merged), [140, 130, 120, 110, 100]);
});

test('an empty poll keeps records older than where it started', () => {
  assert.deepEqual(times(mergeTail([log(120), log(90)], [], 100, false)), [90]);
});

test('the buffer is capped', () => {
  const buffer = Array.from({ length: TAIL_BUFFER }, (_, index) => log(1000 - index));
  const merged = mergeTail(buffer, [log(2000)], 1001, false);
  assert.equal(merged.length, TAIL_BUFFER);
  assert.equal(merged[0]!.timestamp, 2000);
});
