import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { ApiStore, EMPTY_SNAPSHOT } from './api-store';

interface Pending {
  path: string;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/** A fetcher whose requests are answered by the test. */
function harness(options: { visible?: () => boolean; maxIdle?: number } = {}) {
  const requests: Pending[] = [];
  const store = new ApiStore({
    fetcher: (path, signal) =>
      new Promise((resolve, reject) => {
        requests.push({ path, signal, resolve, reject });
      }),
    now: () => 1_000,
    isVisible: options.visible ?? (() => true),
    maxIdle: options.maxIdle,
  });
  const answer = async (index: number, value: unknown) => {
    requests[index]?.resolve(value);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { store, requests, answer };
}

test('subscribers to one path share a single request and are all told when it lands', async () => {
  const { store, requests, answer } = harness();
  let told = 0;
  const first = store.subscribe('/services', 15_000, () => told++);
  const second = store.subscribe('/services', 15_000, () => told++);

  assert.equal(requests.length, 1);
  await answer(0, { services: [] });
  assert.equal(told, 2);
  assert.deepEqual(store.peek('/services'), { data: { services: [] }, error: undefined, updatedAt: 1_000 });
  first();
  second();
});

test('a late subscriber sees the cached response and a fresh load starts', async () => {
  const { store, requests, answer } = harness();
  const leave = store.subscribe('/hosts', 15_000, () => {});
  await answer(0, ['a']);
  leave();

  const cached = store.peek('/hosts');
  assert.deepEqual(cached.data, ['a']);
  const again = store.subscribe('/hosts', 15_000, () => {});
  assert.equal(store.peek('/hosts'), cached, 'the snapshot is kept until the new load answers');
  assert.equal(requests.length, 2);
  again();
});

test('an error keeps the last data and reports the failure', async () => {
  const { store, requests, answer } = harness();
  const leave = store.subscribe('/alerts', 15_000, () => {});
  await answer(0, { alerts: 1 });
  store.refetch('/alerts');
  requests[1]?.reject(new Error('boom'));
  await Promise.resolve();
  await Promise.resolve();

  const snapshot = store.peek<{ alerts: number }>('/alerts');
  assert.equal(snapshot.data?.alerts, 1);
  assert.equal(snapshot.error?.message, 'boom');
  leave();
});

test('polling runs at the shortest interval asked for, and only while visible', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let visible = true;
    const { store, requests, answer } = harness({ visible: () => visible });
    const slow = store.subscribe('/context', 60_000, () => {});
    const fast = store.subscribe('/context', 15_000, () => {});
    await answer(0, {});

    mock.timers.tick(15_000);
    assert.equal(requests.length, 2, 'the 15s subscriber sets the pace');
    await answer(1, {});

    visible = false;
    mock.timers.tick(15_000);
    assert.equal(requests.length, 2, 'a hidden tab does not poll');

    visible = true;
    fast();
    mock.timers.tick(15_000);
    assert.equal(requests.length, 2, 'only the 60s subscriber is left');
    mock.timers.tick(45_000);
    assert.equal(requests.length, 3);
    slow();
    mock.timers.tick(120_000);
    assert.equal(requests.length, 3, 'nobody left, nothing polls');
  } finally {
    mock.timers.reset();
  }
});

test('leaving a path aborts its request in flight and evicts the oldest idle paths', () => {
  const { store, requests } = harness({ maxIdle: 2 });
  const leaveA = store.subscribe('/a', 15_000, () => {});
  leaveA();
  assert.equal(requests[0]?.signal.aborted, true);

  store.subscribe('/b', 15_000, () => {})();
  store.subscribe('/c', 15_000, () => {})();
  assert.equal(store.peek('/a'), EMPTY_SNAPSHOT, 'the oldest idle path is gone');
  assert.notEqual(store.peek('/b'), undefined);
});
