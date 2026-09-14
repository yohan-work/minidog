import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatExpectedStatus, matchesStatus, parseExpectedStatus } from './expected-status';

test('parses single codes and ranges', () => {
  assert.deepEqual(parseExpectedStatus('200'), [[200, 200]]);
  assert.deepEqual(parseExpectedStatus(' 200 - 299 , 301 '), [
    [200, 299],
    [301, 301],
  ]);
});

test('rejects invalid input', () => {
  for (const input of ['', ',', 'abc', '99', '600', '300-200', '2xx', '200-']) {
    assert.equal(parseExpectedStatus(input), null, input);
  }
});

test('formats to canonical form, dropping empty segments', () => {
  assert.equal(formatExpectedStatus(parseExpectedStatus('200 - 299, 301')!), '200-299,301');
  assert.equal(formatExpectedStatus(parseExpectedStatus('200,,')!), '200');
});

test('matches codes inside any range', () => {
  const matcher = parseExpectedStatus('200-299,418')!;
  assert.equal(matchesStatus(matcher, 204), true);
  assert.equal(matchesStatus(matcher, 418), true);
  assert.equal(matchesStatus(matcher, 301), false);
  assert.equal(matchesStatus(matcher, 0), false);
});
