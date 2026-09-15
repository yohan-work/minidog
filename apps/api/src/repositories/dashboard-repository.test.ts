import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../db/sqlite';
import { updateSchema, widgetSchema } from '../routes/dashboards';
import { DashboardRepository } from './dashboard-repository';
import { ProjectRepository } from './project-repository';

function setup() {
  const db = openDatabase(':memory:');
  const projects = new ProjectRepository(db);
  const { projectId, environment } = projects.ensureDefault();
  return { dashboards: new DashboardRepository(db), scope: { projectId, environment } };
}

test('dashboards are saved with their widgets in order and stay in their scope', () => {
  const { dashboards, scope } = setup();
  const created = dashboards.create(scope, 'Site');
  assert.deepEqual(created.widgets, []);

  const widgets = [
    { id: 'w1', kind: 'synthetic' as const, title: 'yohan.co.kr', size: 'full' as const, monitorId: 'mon_1' },
    { id: 'w2', kind: 'service' as const, title: 'api requests', size: 'half' as const, service: 'api', chart: 'requests' as const },
  ];
  const updated = dashboards.update(scope, created.id, 'My site', widgets);
  assert.equal(updated?.name, 'My site');
  assert.deepEqual(updated?.widgets, widgets);
  assert.deepEqual(dashboards.list(scope).map((item) => [item.name, item.widgetCount]), [['My site', 2]]);

  const other = { projectId: scope.projectId, environment: 'staging' };
  assert.equal(dashboards.get(other, created.id), undefined);
  assert.equal(dashboards.update(other, created.id, 'x', []), undefined);
  assert.equal(dashboards.delete(other, created.id), false);
  assert.equal(dashboards.delete(scope, created.id), true);
  assert.deepEqual(dashboards.list(scope), []);
});

test('widgets are validated per kind', () => {
  const metric = widgetSchema.parse({ kind: 'metric', metric: 'system.cpu.utilization', aggregation: 'avg' });
  assert.deepEqual(metric, { kind: 'metric', metric: 'system.cpu.utilization', aggregation: 'avg', title: '', size: 'half', service: '', host: '', groupBy: '' });
  assert.equal(widgetSchema.safeParse({ kind: 'service', service: 'api', chart: 'pie' }).success, false);
  assert.equal(widgetSchema.safeParse({ kind: 'synthetic', monitorId: 'm', url: 'x' }).success, false);
  const tooMany = Array.from({ length: 25 }, () => ({ kind: 'synthetic', monitorId: 'm' }));
  const result = updateSchema.safeParse({ name: 'x', widgets: tooMany });
  assert.equal(result.success, false);
  assert.equal(result.error?.issues[0]?.message, 'A dashboard holds at most 24 widgets.');
});
