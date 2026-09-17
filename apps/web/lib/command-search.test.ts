import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchScore, queryCommands, searchCommands, type CommandItem } from './command-search';

const pages: CommandItem[] = [
  { id: 'p:services', kind: 'page', label: 'Services', href: '/services' },
  { id: 'p:logs', kind: 'page', label: 'Logs', href: '/logs' },
  { id: 'p:traces', kind: 'page', label: 'Traces', href: '/traces' },
];

const catalog: CommandItem[] = [
  ...pages,
  { id: 's:api', kind: 'service', label: 'api', detail: 'production', href: '/services/api' },
  { id: 's:checkout', kind: 'service', label: 'checkout', href: '/services/checkout' },
  {
    id: 'e:1',
    kind: 'endpoint',
    label: 'POST /checkout',
    detail: 'api',
    href: '/services/api/endpoint?name=POST%20%2Fcheckout',
  },
];

test('matchScore ranks exact, prefix, word, substring and detail hits', () => {
  const item: CommandItem = { id: '1', kind: 'service', label: 'checkout-api', detail: 'payments', href: '/' };
  assert.equal(matchScore(item, 'checkout-api'), 0);
  assert.equal(matchScore(item, 'check'), 1);
  assert.equal(matchScore(item, 'api'), 2);
  assert.equal(matchScore(item, 'out'), 3);
  assert.equal(matchScore(item, 'pay'), 4);
  assert.equal(matchScore(item, 'missing'), null);
});

test('searchCommands groups by kind and keeps navigation order with an empty query', () => {
  const groups = searchCommands(pages, '');
  assert.deepEqual(
    groups.map((group) => group.kind),
    ['page'],
  );
  assert.deepEqual(
    groups[0]?.items.map((item) => item.label),
    ['Services', 'Logs', 'Traces'],
  );
});

test('searchCommands prefers better scores and limits typed results', () => {
  const groups = searchCommands(catalog, 'api');
  const services = groups.find((group) => group.kind === 'service');
  assert.equal(services?.items[0]?.label, 'api');
  assert.ok(services?.items.every((item) => item.label.includes('api') || item.detail?.includes('api')));
});

test('queryCommands opens a pasted trace id or falls back to search', () => {
  const traceId = '5b8efff798038103d269b633813fc60c';
  assert.deepEqual(queryCommands(traceId), [
    { id: 'trace', kind: 'trace', label: `Open trace ${traceId}`, href: `/traces/${traceId}` },
  ]);
  const search = queryCommands('payment failed');
  assert.equal(search.length, 2);
  assert.equal(search[0]?.href, '/logs?q=payment+failed');
  assert.equal(search[1]?.href, '/traces?q=payment+failed');
  assert.deepEqual(queryCommands(''), []);
});
