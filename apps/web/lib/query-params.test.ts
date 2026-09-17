import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toQuery } from './query-params';

test('toQuery skips empty values and formats a leading ?', () => {
  assert.equal(toQuery({}), '');
  assert.equal(toQuery({ q: '', range: null, from: undefined }), '');
  assert.equal(toQuery({ q: 'error', range: '1h' }), '?q=error&range=1h');
});

test('toQuery repeats keys for array values', () => {
  assert.equal(toQuery({ attr: ['a:1', 'b:2'], q: 'x' }), '?attr=a%3A1&attr=b%3A2&q=x');
  assert.equal(toQuery({ attr: [] }), '');
});
