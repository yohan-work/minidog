import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsSetup } from './onboarding';

test('setup instructions wait until both counts have loaded', () => {
  assert.equal(needsSetup(undefined, undefined), false);
  assert.equal(needsSetup(0, undefined), false);
  assert.equal(needsSetup(undefined, 0), false);
});

test('a fresh install needs setup, and keeps needing it while host metrics arrive', () => {
  assert.equal(needsSetup(0, 0), true);
});

test('one service or one check is enough to show the dashboard', () => {
  assert.equal(needsSetup(1, 0), false);
  assert.equal(needsSetup(0, 1), false);
  assert.equal(needsSetup(3, 2), false);
});
