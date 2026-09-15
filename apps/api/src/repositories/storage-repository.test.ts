import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRetentionDays } from './storage-repository';

test('reads the retention days from a table definition', () => {
  const printed = `CREATE TABLE minidog.spans (\`timestamp\` DateTime64(6, 'UTC')) ENGINE = MergeTree PARTITION BY toDate(timestamp) ORDER BY (project_id, timestamp) TTL toDateTime(timestamp) + toIntervalDay(14) SETTINGS index_granularity = 8192`;
  assert.equal(parseRetentionDays(printed), 14);
  assert.equal(parseRetentionDays('ENGINE = MergeTree\nTTL toDateTime(timestamp) + INTERVAL 90 DAY'), 90);
  assert.equal(parseRetentionDays('TTL toDateTime(timestamp) + toIntervalMonth(3)'), 90);
  assert.equal(parseRetentionDays('TTL toDateTime(timestamp) + toIntervalWeek(2)'), 14);
  assert.equal(parseRetentionDays('TTL toDateTime(timestamp) + INTERVAL 1 YEAR'), 365);
  assert.equal(parseRetentionDays('CREATE TABLE t (x UInt8) ENGINE = MergeTree ORDER BY x'), null);
});
