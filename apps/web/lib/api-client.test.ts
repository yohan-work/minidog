import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { ApiClientError, apiFetch, toApiClientError } from './api-client';

afterEach(() => {
  mock.restoreAll();
});

test('apiFetch prefixes /api, sends the dashboard header and returns JSON', async () => {
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/services?range=1h');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-minidog-request'), '1');
    assert.equal(headers.get('content-type'), 'application/json');
    return new Response(JSON.stringify({ services: [] }), { status: 200 });
  });
  assert.deepEqual(await apiFetch('/services?range=1h', { method: 'POST', body: '{}' }), { services: [] });
});

test('apiFetch turns 204 into undefined and API error bodies into ApiClientError', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  assert.equal(await apiFetch('/alerting/events/acknowledge', { method: 'POST' }), undefined);

  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: { code: 'validation_error', message: 'Bad', details: [{ path: 'url', message: 'required' }] },
        }),
        {
          status: 400,
        },
      ),
  );
  await assert.rejects(
    () => apiFetch('/monitors', { method: 'POST', body: '{}' }),
    (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'validation_error');
      assert.equal(error.validationIssues[0]?.path, 'url');
      return true;
    },
  );
});

test('toApiClientError wraps unknown failures', () => {
  const wrapped = toApiClientError(new Error('boom'));
  assert.equal(wrapped.code, 'unknown_error');
  assert.equal(wrapped.message, 'boom');
  const same = new ApiClientError(500, 'x', 'y');
  assert.equal(toApiClientError(same), same);
});
