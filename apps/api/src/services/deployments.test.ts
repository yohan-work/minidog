import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RawVersionRow } from '../repositories/span-repository';
import { deriveDeployments, summarizeVersions } from './deployments';

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 15, 12, 0, 0);
const fromMs = now - HOUR;

const row = (service: string, version: string, firstSeenAt: number, requests = 10): RawVersionRow => ({
  service,
  version,
  firstSeenAt,
  lastSeenAt: now,
  requests,
  errors: 1,
  p95Ms: 120,
});

test('a version first seen in the range after an earlier one is a deployment', () => {
  const deployments = deriveDeployments(
    [row('api', '1.0.0', now - 5 * HOUR), row('api', '1.1.0', now - 20 * 60_000), row('web', '2.0.0', now - 3 * HOUR)],
    fromMs,
  );
  assert.deepEqual(deployments, [
    { service: 'api', version: '1.1.0', previousVersion: '1.0.0', at: now - 20 * 60_000 },
  ]);
});

test("a service's first version and versions deployed before the range are not deployments", () => {
  assert.deepEqual(deriveDeployments([row('api', '1.0.0', now - 10 * 60_000)], fromMs), []);
  assert.deepEqual(
    deriveDeployments([row('api', '1.0.0', now - 5 * HOUR), row('api', '1.1.0', now - 2 * HOUR)], fromMs),
    [],
  );
});

test('several deployments are ordered by time across services', () => {
  const deployments = deriveDeployments(
    [
      row('web', '1.0.0', now - 5 * HOUR),
      row('web', '1.1.0', now - 10 * 60_000),
      row('api', '3.0.0', now - 5 * HOUR),
      row('api', '3.1.0', now - 40 * 60_000),
      row('api', '3.2.0', now - 30 * 60_000),
    ],
    fromMs,
  );
  assert.deepEqual(
    deployments.map((deployment) => `${deployment.service} ${deployment.previousVersion}→${deployment.version}`),
    ['api 3.0.0→3.1.0', 'api 3.1.0→3.2.0', 'web 1.0.0→1.1.0'],
  );
});

test('versions in range are listed newest first with an error rate', () => {
  const versions = summarizeVersions(
    [
      row('api', '0.9.0', now - 9 * HOUR, 0),
      row('api', '1.0.0', now - 5 * HOUR),
      row('api', '1.1.0', now - 20 * 60_000),
    ],
    fromMs,
  );
  assert.deepEqual(
    versions.map((version) => version.version),
    ['1.1.0', '1.0.0'],
    'a version without requests in the range is left out',
  );
  assert.equal(versions[0]?.errorRate, 0.1);
});

test('after a rollback, the next deployment replaces the version that was serving', () => {
  const rows: RawVersionRow[] = [
    { ...row('api', '1.0.0', now - 5 * HOUR), lastSeenAt: now - 25 * 60_000 },
    { ...row('api', '1.1.0', now - 4 * HOUR), lastSeenAt: now - 3 * HOUR },
    row('api', '1.2.0', now - 20 * 60_000),
  ];
  assert.deepEqual(deriveDeployments(rows, fromMs), [
    { service: 'api', version: '1.2.0', previousVersion: '1.0.0', at: now - 20 * 60_000 },
  ]);
});
