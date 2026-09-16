import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../db/sqlite';
import { GapRepository } from '../repositories/gap-repository';
import { GapTracker, WAKE_SETTLE_MS } from './gap-tracker';

const MINUTE = 60_000;
const log = { info: () => {} } as never;

function setup(start: number) {
  const gaps = new GapRepository(openDatabase(':memory:'));
  let now = start;
  const tracker = new GapTracker(gaps, log, { now: () => now });
  return { gaps, tracker, advance: (ms: number) => (now += ms), at: () => now };
}

test('a first start records nothing; a later start after downtime records a stopped gap', () => {
  const { gaps, tracker, advance } = setup(1_000_000);
  tracker.start();
  tracker.stop();
  assert.deepEqual(gaps.list(0, Number.MAX_SAFE_INTEGER), []);

  advance(90 * MINUTE);
  const restarted = new GapTracker(gaps, log, { now: () => 1_000_000 + 90 * MINUTE });
  restarted.start();
  restarted.stop();
  assert.deepEqual(gaps.list(0, Number.MAX_SAFE_INTEGER), [
    { from: 1_000_000, to: 1_000_000 + 90 * MINUTE, reason: 'stopped' },
  ]);
});

test('a late tick records an asleep gap and holds checks for a while', () => {
  const { gaps, tracker, advance, at } = setup(5_000_000);
  tracker.start();
  advance(10_000);
  tracker.tick();
  assert.equal(tracker.settling(), false);

  const slept = at();
  advance(30 * MINUTE);
  tracker.tick();
  assert.deepEqual(gaps.list(0, Number.MAX_SAFE_INTEGER), [{ from: slept, to: at(), reason: 'asleep' }]);
  assert.equal(tracker.settling(), true);
  advance(WAKE_SETTLE_MS);
  assert.equal(tracker.settling(), false);
  tracker.stop();
});

test('overlapping reports of the same sleep become one gap', () => {
  const { gaps, tracker } = setup(0);
  tracker.noteSleep(1_000, 60_000);
  tracker.noteSleep(5_000, 62_000);
  assert.deepEqual(gaps.list(0, 100_000), [{ from: 1_000, to: 62_000, reason: 'asleep' }]);
  assert.deepEqual(gaps.list(30_000, 40_000), [{ from: 30_000, to: 40_000, reason: 'asleep' }]);
});

test('a heartbeat that cannot be written is logged, not thrown', () => {
  const gaps = new GapRepository(openDatabase(':memory:'));
  gaps.setHeartbeat = () => {
    throw new Error('SQLITE_FULL: database or disk is full');
  };
  const warnings: unknown[] = [];
  const noisy = { info: () => {}, warn: (details: unknown) => warnings.push(details) } as never;
  const tracker = new GapTracker(gaps, noisy, { now: () => 2_000_000 });

  // A throw here would come from a timer and take the whole process down.
  assert.doesNotThrow(() => tracker.tick());
  assert.doesNotThrow(() => tracker.stop());
  assert.equal(warnings.length, 2);
});

test('a gap for another reason starts where the previous one ends', () => {
  const gaps = new GapRepository(openDatabase(':memory:'));
  gaps.record(10_000, 20_000, 'asleep');
  gaps.record(5_000, 30_000, 'stopped');
  assert.deepEqual(gaps.list(0, 100_000), [
    { from: 10_000, to: 20_000, reason: 'asleep' },
    { from: 20_000, to: 30_000, reason: 'stopped' },
  ]);
});
