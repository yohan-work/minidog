import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../db/sqlite';
import { MonitorRepository } from './monitor-repository';
import { ProjectRepository } from './project-repository';

test('monitors are created enabled, listed by scope, and removed', () => {
  const db = openDatabase(':memory:');
  const projects = new ProjectRepository(db);
  const scope = projects.ensureDefault();
  const monitors = new MonitorRepository(db);

  const created = monitors.create(
    { projectId: scope.projectId, environment: scope.environment },
    {
      name: 'example.com',
      url: 'https://example.com',
      method: 'GET',
      intervalSeconds: 60,
      timeoutMs: 5_000,
      expectedStatus: '200-399',
      followRedirects: true,
      bodyContains: '',
    },
  );
  assert.equal(created.enabled, true);
  assert.equal(created.followRedirects, true);
  assert.equal(monitors.list({ projectId: scope.projectId, environment: scope.environment }).length, 1);
  assert.equal(monitors.listEnabled().length, 1);

  monitors.update(created.id, { enabled: false, name: 'paused' });
  assert.equal(monitors.get(created.id)?.enabled, false);
  assert.equal(monitors.listEnabled().length, 0);
  assert.equal(monitors.delete(created.id), true);
  assert.equal(monitors.get(created.id), undefined);
});
