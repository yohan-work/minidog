import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyCheckIssue, createMonitorSchema, timeoutIssue, updateMonitorSchema } from './schemas';

test('new monitors follow redirects and skip the body check by default', () => {
  const monitor = createMonitorSchema.parse({ url: 'https://example.com' });
  assert.equal(monitor.followRedirects, true);
  assert.equal(monitor.bodyContains, '');
});

test('a body check needs GET', () => {
  const result = createMonitorSchema.safeParse({ url: 'https://example.com', method: 'HEAD', bodyContains: 'Welcome' });
  assert.equal(result.success, false);
  assert.deepEqual(
    result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]),
    [['bodyContains', 'A body check needs GET; HEAD responses have no body.']],
  );
  assert.equal(updateMonitorSchema.parse({ bodyContains: '  Welcome ' }).bodyContains, 'Welcome');
});

test('issues used after a failed parse still carry their message', () => {
  // zod's refine() deletes `message` from the params object it keeps.
  createMonitorSchema.safeParse({ url: 'https://example.com', intervalSeconds: 30, timeoutMs: 30_000, method: 'HEAD', bodyContains: 'x' });
  assert.equal(timeoutIssue().message, 'Timeout must be shorter than the interval.');
  assert.equal(bodyCheckIssue().message, 'A body check needs GET; HEAD responses have no body.');
});
