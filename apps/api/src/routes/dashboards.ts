import {
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_WIDGET_SIZES,
  METRIC_AGGREGATIONS,
  SERVICE_WIDGET_CHARTS,
  type DashboardWidget,
} from '@minidog/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { HttpError, NotFoundError } from '../lib/errors';
import { createId } from '../lib/id';
import { idParamsSchema } from './schemas';

const optionalText = (max: number) => z.string().trim().max(max).default('');
const base = {
  /** Saved widgets keep their id; new ones get one here. */
  id: z.string().min(1).max(64).optional(),
  title: z.string().trim().max(80, 'Use at most 80 characters.').default(''),
  size: z.enum(DASHBOARD_WIDGET_SIZES).default('half'),
};

export const widgetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('metric'),
      ...base,
      metric: z.string().trim().min(1, 'Choose a metric.').max(255),
      aggregation: z.enum(METRIC_AGGREGATIONS),
      service: optionalText(255),
      host: optionalText(255),
      // The values the metrics query accepts.
      groupBy: optionalText(255).refine((value) => /^(|service|host|attr:\S+)$/.test(value), 'Group by service, host or attr:<key>.'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('service'),
      ...base,
      service: z.string().trim().min(1, 'Choose a service.').max(255),
      chart: z.enum(SERVICE_WIDGET_CHARTS),
    })
    .strict(),
  z
    .object({
      kind: z.literal('synthetic'),
      ...base,
      monitorId: z.string().trim().min(1, 'Choose a monitor.').max(64),
    })
    .strict(),
]);

const nameSchema = z.string().trim().min(1, 'Name is required.').max(100, 'Use at most 100 characters.');
const createSchema = z.object({ name: nameSchema }).strict();
export const updateSchema = z
  .object({
    name: nameSchema,
    widgets: z.array(widgetSchema).max(DASHBOARD_MAX_WIDGETS, `A dashboard holds at most ${DASHBOARD_MAX_WIDGETS} widgets.`),
  })
  .strict();
const addWidgetSchema = z.object({ widget: widgetSchema }).strict();

function withIds(widgets: readonly z.infer<typeof widgetSchema>[]): DashboardWidget[] {
  return widgets.map((widget) => ({ ...widget, id: widget.id ?? createId('wid', 10) }) as DashboardWidget);
}

export function registerDashboardRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { dashboards, scope } = ctx;
  const require = (id: string) => {
    const dashboard = dashboards.get(scope, id);
    if (!dashboard) throw new NotFoundError('Dashboard');
    return dashboard;
  };

  app.get('/api/dashboards', async () => ({ dashboards: dashboards.list(scope) }));

  app.post('/api/dashboards', async (request, reply) => {
    const { name } = createSchema.parse(request.body ?? {});
    return reply.status(201).send({ dashboard: dashboards.create(scope, name) });
  });

  app.get('/api/dashboards/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return { dashboard: require(id) };
  });

  app.put('/api/dashboards/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { name, widgets } = updateSchema.parse(request.body ?? {});
    require(id);
    return { dashboard: dashboards.update(scope, id, name, withIds(widgets))! };
  });

  app.delete('/api/dashboards/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    if (!dashboards.delete(scope, id)) throw new NotFoundError('Dashboard');
    return reply.status(204).send();
  });

  /** Appends one widget, e.g. "Add to dashboard" on the Metrics explorer. */
  app.post('/api/dashboards/:id/widgets', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { widget } = addWidgetSchema.parse(request.body ?? {});
    const dashboard = require(id);
    if (dashboard.widgets.length >= DASHBOARD_MAX_WIDGETS) {
      throw new HttpError(409, 'dashboard_full', `A dashboard holds at most ${DASHBOARD_MAX_WIDGETS} widgets.`);
    }
    return { dashboard: dashboards.update(scope, id, dashboard.name, [...dashboard.widgets, ...withIds([widget])])! };
  });
}
