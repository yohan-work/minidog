import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Counter } from '@opentelemetry/api';
import { callService, dbQuery, getMeter, log, startTelemetry, step } from './telemetry';
import { serve, type Route } from './server';

/**
 * Demo shop: web → api → (postgres.query, payment). Run all three services
 * with `pnpm --filter @minidog/demo-shop start`; the web service also
 * generates traffic. Change behaviour at runtime:
 *
 *   curl -X POST localhost:5100/__demo/scenario -d '{"slowDb":true,"paymentErrorRate":0.2}'
 *   curl -X POST localhost:5100/__demo/scenario -d '{"dbDelayMs":300}'   # step latency up gradually
 */

const SERVICES = ['web', 'api', 'payment'] as const;
type ServiceName = (typeof SERVICES)[number];

const PORT_BASE = Number(process.env.DEMO_PORT_BASE ?? 5100);
const PORTS: Record<ServiceName, number> = { web: PORT_BASE, api: PORT_BASE + 1, payment: PORT_BASE + 2 };
const url = (service: ServiceName, path: string) => `http://127.0.0.1:${PORTS[service]}${path}`;

interface Scenario {
  /** Order inserts take ~580 ms instead of ~35 ms. */
  slowDb: boolean;
  /** Exact order insert latency (±10%); overrides slowDb. null to clear. */
  dbDelayMs: number | null;
  /** Share of payments the issuer declines, 0..1. */
  paymentErrorRate: number;
}

const scenario: Scenario = { slowDb: false, dbDelayMs: null, paymentErrorRate: 0.02 };

const between = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

function applyScenario(body: unknown): Scenario {
  const patch = (body ?? {}) as Partial<Scenario>;
  if (typeof patch.slowDb === 'boolean') scenario.slowDb = patch.slowDb;
  if (patch.dbDelayMs === null || typeof patch.dbDelayMs === 'number') {
    scenario.dbDelayMs = patch.dbDelayMs === null ? null : Math.max(patch.dbDelayMs, 0);
  }
  if (typeof patch.paymentErrorRate === 'number')
    scenario.paymentErrorRate = Math.min(Math.max(patch.paymentErrorRate, 0), 1);
  return scenario;
}

const ROUTES: Record<ServiceName, Route[]> = {
  web: [
    { method: 'GET', route: '/products', handler: async () => callService('api', 'GET', url('api', '/products')) },
    {
      method: 'POST',
      route: '/checkout',
      handler: async ({ body }) => callService('api', 'POST', url('api', '/checkout'), body),
    },
    {
      method: 'GET',
      route: '/orders/:id',
      handler: async ({ params }) => callService('api', 'GET', url('api', `/orders/${params.id}`)),
    },
  ],
  api: [
    {
      method: 'GET',
      route: '/products',
      handler: async () => {
        await dbQuery('SELECT id, name, price FROM products LIMIT 50', 'products', between(12, 40));
        return { status: 200, body: { products: 50 } };
      },
    },
    {
      method: 'GET',
      route: '/orders/:id',
      handler: async ({ params }) => {
        await dbQuery('SELECT * FROM orders WHERE id = $1', 'orders', between(8, 20));
        return { status: 200, body: { id: params.id } };
      },
    },
    {
      method: 'POST',
      route: '/checkout',
      handler: async () => {
        const orderId = `ord_${Math.random().toString(36).slice(2, 10)}`;
        await step('order.validate', async () => undefined);
        const insertMs =
          scenario.dbDelayMs !== null
            ? between(scenario.dbDelayMs * 0.9, scenario.dbDelayMs * 1.1)
            : scenario.slowDb
              ? between(520, 640)
              : between(20, 50);
        await dbQuery('INSERT INTO orders (id, items, total) VALUES ($1, $2, $3)', 'orders', insertMs);
        if (insertMs > 400)
          log('warn', 'slow query on orders insert', { 'db.duration_ms': insertMs, 'order.id': orderId });

        const payment = await callService('payment', 'POST', url('payment', '/payment'), { orderId });
        if (payment.status >= 400) {
          log('error', 'payment request failed', {
            'order.id': orderId,
            route: '/checkout',
            'payment.status': payment.status,
          });
          return { status: 500, body: { error: 'payment request failed' } };
        }
        ordersPlaced?.add(1);
        log('info', 'order placed', { 'order.id': orderId });
        return { status: 201, body: { orderId } };
      },
    },
  ],
  payment: [
    {
      method: 'POST',
      route: '/payment',
      handler: async ({ body }) => {
        const orderId = String((body as { orderId?: string } | undefined)?.orderId ?? 'unknown');
        await step('payment.authorize', async () => {
          await new Promise((resolve) => setTimeout(resolve, between(60, 180)));
          if (Math.random() < scenario.paymentErrorRate) throw new Error('card declined by issuer');
        });
        log('info', 'payment authorized', { 'order.id': orderId });
        return { status: 200, body: { authorized: true } };
      },
    },
  ],
};

/** Created once the SDK has started. */
let ordersPlaced: Counter | undefined;

function runService(service: ServiceName): void {
  const sdk = startTelemetry(service);
  const meter = getMeter();
  ordersPlaced = meter.createCounter('shop.orders.placed', { description: 'Orders placed', unit: '{order}' });
  meter
    .createObservableGauge('shop.queue.depth', { description: 'Pending jobs', unit: '{job}' })
    .addCallback((result) => result.observe(between(0, 12), { service }));

  serve(service, PORTS[service], ROUTES[service], {
    onScenario: async (body) => {
      const next = applyScenario(body);
      // The web service fans scenario changes out to the others.
      if (service === 'web' && body !== undefined) {
        await Promise.all(
          (['api', 'payment'] as const).map((peer) =>
            fetch(url(peer, '/__demo/scenario'), { method: 'POST', body: JSON.stringify(next) }).catch(() => undefined),
          ),
        );
      }
      return next;
    },
  });

  if (service === 'web') generateTraffic();

  const shutdown = () => void sdk.shutdown().finally(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

/** Untraced client requests, so each web request starts a new trace. */
function generateTraffic(): void {
  const intervalMs = Number(process.env.DEMO_INTERVAL_MS ?? 300);
  setInterval(() => {
    const roll = Math.random();
    const request =
      roll < 0.55
        ? fetch(url('web', '/products'))
        : roll < 0.85
          ? fetch(url('web', '/checkout'), { method: 'POST', body: JSON.stringify({ items: between(1, 4) }) })
          : fetch(url('web', `/orders/${between(1000, 9999)}`));
    request.catch(() => undefined);
  }, intervalMs);
}

const selected = process.env.DEMO_SERVICE;
if (selected && (SERVICES as readonly string[]).includes(selected)) {
  runService(selected as ServiceName);
} else {
  // Parent process: one child per service, sharing this process's loader.
  const children = SERVICES.map((service) =>
    fork(fileURLToPath(import.meta.url), { env: { ...process.env, DEMO_SERVICE: service } }),
  );
  const stop = () => {
    for (const child of children) child.kill('SIGTERM');
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
