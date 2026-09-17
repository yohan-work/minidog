import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClickHouseClient } from '@clickhouse/client';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { openDatabase } from '../db/sqlite';

interface Recorded {
  query: string;
  params: Record<string, unknown>;
}

/** Records every query; answers the facet queries with a fixed shape and everything else with no rows. */
function clickHouse(recorded: Recorded[]) {
  return {
    ping: async () => ({ success: true }),
    command: async () => undefined,
    close: async () => undefined,
    insert: async () => undefined,
    query: async ({ query, query_params }: { query: string; query_params: Record<string, unknown> }) => {
      recorded.push({ query, params: query_params });
      const rows = query.includes('mapValues(attributes)')
        ? [
            { key: 'http.method', value: 'GET', count: '7' },
            { key: 'http.method', value: 'POST', count: '2' },
            { key: 'user.id', value: 'u1', count: '3' },
          ]
        : query.includes('mapKeys(attributes)')
          ? [
              { key: 'http.method', count: '9' },
              { key: 'user.id', count: '3' },
            ]
          : [];
      return { json: async () => rows };
    },
  } as unknown as ClickHouseClient;
}

async function start(recorded: Recorded[]) {
  const config = loadConfig({
    SQLITE_PATH: ':memory:',
    WORKER_ENABLED: 'false',
    ALERTS_ENABLED: 'false',
    AUTH_DISABLED: 'true',
    LOG_LEVEL: 'silent',
  });
  return buildApp(config, { sqlite: openDatabase(':memory:'), clickhouse: clickHouse(recorded) });
}

test('attribute filters reach every log query as map lookups, and the key ends at the first colon', async () => {
  const recorded: Recorded[] = [];
  const app = await start(recorded);
  try {
    const response = await app.inject({ url: '/api/logs?attr=http.method:GET&attr=url.path:/a:b' });
    assert.equal(response.statusCode, 200);

    const searches = recorded.filter((entry) => entry.query.includes('FROM logs') && !entry.query.includes('DISTINCT'));
    assert.ok(searches.length >= 3, 'records, volume and facets are all filtered');
    for (const { query, params } of searches) {
      // The key must be present: a Map reads a missing key as '', which an empty-value filter would otherwise match.
      assert.match(
        query,
        /mapContains\(attributes, \{attrKey0:String\}\) AND attributes\[\{attrKey0:String\}\] = \{attrValue0:String\}/,
      );
      assert.match(
        query,
        /mapContains\(attributes, \{attrKey1:String\}\) AND attributes\[\{attrKey1:String\}\] = \{attrValue1:String\}/,
      );
      assert.equal(params.attrKey0, 'http.method');
      assert.equal(params.attrValue0, 'GET');
      assert.equal(params.attrKey1, 'url.path');
      assert.equal(params.attrValue1, '/a:b');
    }
  } finally {
    await app.close();
  }
});

test('facets list each key with its commonest values; a trace lookup has none', async () => {
  const recorded: Recorded[] = [];
  const app = await start(recorded);
  try {
    const response = await app.inject({ url: '/api/logs' });
    assert.deepEqual(response.json().facets, [
      {
        key: 'http.method',
        count: 9,
        values: [
          { value: 'GET', count: 7 },
          { value: 'POST', count: 2 },
        ],
      },
      { key: 'user.id', count: 3, values: [{ value: 'u1', count: 3 }] },
    ]);

    recorded.length = 0;
    const byTrace = await app.inject({ url: `/api/logs?traceId=${'a'.repeat(32)}` });
    assert.deepEqual(byTrace.json().facets, []);
    assert.equal(
      recorded.some((entry) => entry.query.includes('mapKeys')),
      false,
    );
  } finally {
    await app.close();
  }
});

test('attribute filters are validated', async () => {
  const app = await start([]);
  try {
    const noColon = await app.inject({ url: '/api/logs?attr=nocolon' });
    assert.equal(noColon.statusCode, 400);
    assert.equal(noColon.json().error.message, 'Give attribute filters as key:value.');

    const tooMany = await app.inject({
      url: `/api/logs?${Array.from({ length: 6 }, (_, i) => `attr=k${i}:v`).join('&')}`,
    });
    assert.equal(tooMany.statusCode, 400);
    assert.equal(tooMany.json().error.message, 'At most 5 attribute filters.');

    const empty = await app.inject({ url: '/api/logs?attr=' });
    assert.equal(empty.statusCode, 200);
  } finally {
    await app.close();
  }
});
