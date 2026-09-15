import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveServiceHealth } from './service-health';

test('healthy with few errors and fast responses', () => {
  assert.deepEqual(deriveServiceHealth({ requests: 1000, errors: 5, p95Ms: 240 }), { health: 'healthy', reason: null });
});

test('unknown without requests in the current window', () => {
  assert.deepEqual(deriveServiceHealth({ requests: 0, errors: 0, p95Ms: null }), {
    health: 'unknown',
    reason: 'No recent requests',
  });
});

test('error rate: degraded from 2%, critical from 10%', () => {
  assert.deepEqual(deriveServiceHealth({ requests: 1000, errors: 58, p95Ms: 300 }), {
    health: 'degraded',
    reason: 'Error rate 5.8%',
  });
  assert.deepEqual(deriveServiceHealth({ requests: 100, errors: 12, p95Ms: 300 }), {
    health: 'critical',
    reason: 'Error rate 12.0%',
  });
});

test('latency: degraded from 1 s, critical from 3 s', () => {
  assert.deepEqual(deriveServiceHealth({ requests: 100, errors: 0, p95Ms: 1420 }), {
    health: 'degraded',
    reason: 'P95 1.42 s',
  });
  assert.deepEqual(deriveServiceHealth({ requests: 100, errors: 0, p95Ms: 3200 }), {
    health: 'critical',
    reason: 'P95 3.20 s',
  });
});

test('with few requests any failure is degraded rather than a rate', () => {
  assert.deepEqual(deriveServiceHealth({ requests: 3, errors: 1, p95Ms: 100 }), {
    health: 'degraded',
    reason: '1 of 3 requests failed',
  });
});

test('error rate is reported before latency', () => {
  assert.equal(deriveServiceHealth({ requests: 100, errors: 5, p95Ms: 1500 }).reason, 'Error rate 5.0%');
});
