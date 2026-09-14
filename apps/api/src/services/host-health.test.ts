import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveHostHealth, type HostHealthInput } from './host-health';

const now = Date.UTC(2026, 8, 14, 12, 0, 0);

const input = (overrides: Partial<HostHealthInput> = {}): HostHealthInput => ({
  lastSeenAt: now - 15_000,
  cpu: 0.2,
  memory: 0.4,
  disk: 0.5,
  diskMountpoint: '/',
  now,
  ...overrides,
});

test('healthy while every resource is under the thresholds', () => {
  assert.deepEqual(deriveHostHealth(input()), { health: 'healthy', reason: null });
});

test('unknown when the host has not reported within the current window', () => {
  assert.deepEqual(deriveHostHealth(input({ lastSeenAt: now - 6 * 60_000 })), { health: 'unknown', reason: 'Not reporting' });
});

test('degraded at 85%, critical at 95%', () => {
  assert.deepEqual(deriveHostHealth(input({ memory: 0.88 })), { health: 'degraded', reason: 'Memory 88%' });
  assert.deepEqual(deriveHostHealth(input({ disk: 0.96 })), { health: 'critical', reason: 'Disk 96% on /' });
});

test('the fullest resource explains the state', () => {
  assert.deepEqual(deriveHostHealth(input({ cpu: 0.9, memory: 0.97 })), { health: 'critical', reason: 'Memory 97%' });
});

test('unknown when no utilization metrics arrive', () => {
  const result = deriveHostHealth(input({ cpu: null, memory: null, disk: null }));
  assert.deepEqual(result, { health: 'unknown', reason: 'No utilization metrics' });
});
