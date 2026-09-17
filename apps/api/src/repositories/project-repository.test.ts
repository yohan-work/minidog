import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../db/sqlite';
import { ProjectRepository } from './project-repository';

test('ensureDefault creates Personal / production once and remembers the active scope', () => {
  const db = openDatabase(':memory:');
  const projects = new ProjectRepository(db);

  const first = projects.ensureDefault();
  assert.equal(first.projectName, 'Personal');
  assert.equal(first.environment, 'production');
  assert.equal(projects.ensureDefault().projectId, first.projectId);

  const listed = projects.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(
    listed[0]?.environments.map((environment) => environment.name),
    ['production'],
  );

  projects.setActiveScope({ projectId: first.projectId, environment: 'production' });
  assert.deepEqual(projects.activeScope(), { projectId: first.projectId, environment: 'production' });
});

test('a second environment stays on the same project', () => {
  const db = openDatabase(':memory:');
  const projects = new ProjectRepository(db);
  const { projectId } = projects.ensureDefault();
  projects.addEnvironment(projectId, 'staging');
  const project = projects.get(projectId);
  assert.deepEqual(
    project?.environments.map((environment) => environment.name),
    ['production', 'staging'],
  );
});
