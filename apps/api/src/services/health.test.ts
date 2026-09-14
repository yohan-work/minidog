import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveHealth, type HealthInput } from './health';

const now = Date.UTC(2026, 8, 14, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const input = (overrides: Partial<HealthInput> = {}): HealthInput => ({
  enabled: true,
  intervalSeconds: 60,
  lastStatus: 'up',
  lastCheckedAt: now - 10_000,
  recentStatuses: ['up', 'up', 'up', 'up', 'up'],
  sslExpiresAt: now + 90 * DAY,
  now,
  ...overrides,
});

test('healthy when recent checks pass', () => {
  assert.deepEqual(deriveHealth(input()), { health: 'healthy', reason: null, stale: false });
});

test('unknown when paused, never checked, or stale', () => {
  assert.equal(deriveHealth(input({ enabled: false })).reason, 'Paused');
  assert.equal(deriveHealth(input({ lastCheckedAt: null, lastStatus: null })).health, 'unknown');

  const stale = deriveHealth(input({ lastCheckedAt: now - 10 * 60_000 }));
  assert.equal(stale.health, 'unknown');
  assert.equal(stale.stale, true);
});

test('a single failure after passing checks is degraded, two in a row are critical', () => {
  assert.equal(deriveHealth(input({ lastStatus: 'down', recentStatuses: ['down', 'up', 'up'] })).health, 'degraded');

  const critical = deriveHealth(input({ lastStatus: 'down', recentStatuses: ['down', 'down', 'up'] }));
  assert.equal(critical.health, 'critical');
  assert.equal(critical.reason, 'Failed 2 consecutive checks');
});

test('the very first check failing is critical', () => {
  assert.equal(deriveHealth(input({ lastStatus: 'down', recentStatuses: ['down'] })).health, 'critical');
});

test('recovered but with recent failures is degraded', () => {
  const result = deriveHealth(input({ recentStatuses: ['up', 'down', 'up', 'up', 'up'] }));
  assert.equal(result.health, 'degraded');
  assert.equal(result.reason, 'Failed 1 of last 5 checks');
});

test('certificate expiring soon is degraded', () => {
  const result = deriveHealth(input({ sslExpiresAt: now + 5 * DAY }));
  assert.equal(result.health, 'degraded');
  assert.equal(result.reason, 'SSL certificate expires in 5 days');
});
