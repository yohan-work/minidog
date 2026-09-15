import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { HttpError, NotFoundError } from '../lib/errors';
import { idParamsSchema } from './schemas';
import { contextResponse } from './system';

const environmentName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, 'Use lowercase letters, digits, dots, dashes or underscores.');

const projectSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(100, 'Use at most 100 characters.'),
    environment: environmentName.default('production'),
  })
  .strict();

const environmentSchema = z.object({ name: environmentName }).strict();
const contextSchema = z.object({ projectId: z.string().min(1).max(64), environment: environmentName }).strict();
const apiKeySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(100, 'Use at most 100 characters.'),
    environment: environmentName,
  })
  .strict();
const keyParamsSchema = z.object({ id: z.string().min(1).max(64), keyId: z.string().min(1).max(64) });

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { projects, apiKeys } = ctx;

  const requireProject = (id: string) => {
    const project = projects.get(id);
    if (!project) throw new NotFoundError('Project');
    return project;
  };

  const requireEnvironment = (projectId: string, environment: string, field: string) => {
    if (!projects.hasEnvironment(projectId, environment)) {
      throw new z.ZodError([
        { code: 'custom', input: environment, path: [field], message: 'This environment does not exist.' },
      ]);
    }
  };

  app.get('/api/projects', async () => ({ projects: projects.list(), active: { ...ctx.scope } }));

  app.post('/api/projects', async (request, reply) => {
    const { name, environment } = projectSchema.parse(request.body ?? {});
    return reply.status(201).send({ project: projects.create(name, environment) });
  });

  app.post('/api/projects/:id/environments', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { name } = environmentSchema.parse(request.body ?? {});
    requireProject(id);
    if (projects.hasEnvironment(id, name))
      throw new HttpError(409, 'environment_exists', `The environment "${name}" already exists.`);
    return reply.status(201).send({ project: projects.addEnvironment(id, name) });
  });

  /** Switches the project and environment every screen shows. */
  app.put('/api/context', async (request) => {
    const next = contextSchema.parse(request.body ?? {});
    requireProject(next.projectId);
    requireEnvironment(next.projectId, next.environment, 'environment');
    projects.setActiveScope(next);
    // Services share this object; updating it in place switches them all.
    Object.assign(ctx.scope, next);
    return contextResponse(ctx);
  });

  app.get('/api/projects/:id/api-keys', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    requireProject(id);
    return { apiKeys: apiKeys.list(id) };
  });

  app.post('/api/projects/:id/api-keys', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { name, environment } = apiKeySchema.parse(request.body ?? {});
    requireProject(id);
    requireEnvironment(id, environment, 'environment');
    return reply.status(201).send(apiKeys.create({ projectId: id, environment }, name));
  });

  app.delete('/api/projects/:id/api-keys/:keyId', async (request, reply) => {
    const { id, keyId } = keyParamsSchema.parse(request.params);
    requireProject(id);
    if (!apiKeys.revoke(id, keyId)) throw new NotFoundError('Active API key');
    return reply.status(204).send();
  });
}
