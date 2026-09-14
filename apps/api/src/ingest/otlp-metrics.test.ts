import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOtlpMetrics } from './otlp-metrics';

const scope = { projectId: 'prj_1', environment: 'production' };
const now = Date.UTC(2026, 8, 14, 12, 0, 0);
const nanos = (ms: number) => String(BigInt(ms) * 1_000_000n);
const str = (key: string, value: string) => ({ key, value: { stringValue: value } });

const hostRequest = (resource = [str('host.name', 'web-1'), str('os.type', 'linux')]) => ({
  resourceMetrics: [
    {
      resource: { attributes: resource },
      scopeMetrics: [
        {
          metrics: [
            {
              name: 'system.cpu.utilization',
              unit: '1',
              gauge: {
                dataPoints: [
                  { attributes: [str('cpu', 'cpu0'), str('state', 'idle')], timeUnixNano: nanos(now - 1000), asDouble: 0.75 },
                ],
              },
            },
            {
              name: 'system.network.io',
              unit: 'By',
              sum: {
                aggregationTemporality: 1,
                isMonotonic: true,
                dataPoints: [{ attributes: [str('device', 'eth0'), str('direction', 'receive')], timeUnixNano: nanos(now), asInt: '2048' }],
              },
            },
            { name: 'http.server.duration', histogram: { dataPoints: [{}, {}] } },
          ],
        },
      ],
    },
  ],
});

test('maps gauge and sum data points to metric rows', () => {
  const { rows, rejected } = parseOtlpMetrics(hostRequest(), scope, now);

  assert.equal(rows.length, 2);
  assert.equal(rejected, 2, 'histogram points are counted as rejected');
  assert.deepEqual(rows[0], {
    project_id: 'prj_1',
    environment: 'production',
    service: '',
    host: 'web-1',
    resource_attributes: { 'host.name': 'web-1', 'os.type': 'linux' },
    timestamp: '2026-09-14 11:59:59.000',
    metric_name: 'system.cpu.utilization',
    metric_type: 'gauge',
    temporality: '',
    unit: '1',
    value: 0.75,
    attributes: { cpu: 'cpu0', state: 'idle' },
  });
  assert.equal(rows[1]?.metric_type, 'sum');
  assert.equal(rows[1]?.temporality, 'delta');
  assert.equal(rows[1]?.value, 2048);
});

test('takes the environment from resource attributes and falls back to the scope', () => {
  const staging = parseOtlpMetrics(hostRequest([str('host.name', 'web-1'), str('deployment.environment.name', 'staging')]), scope, now);
  assert.equal(staging.rows[0]?.environment, 'staging');

  const legacy = parseOtlpMetrics(hostRequest([str('deployment.environment', 'dev')]), scope, now);
  assert.equal(legacy.rows[0]?.environment, 'dev');
  assert.equal(legacy.rows[0]?.host, '');
});

test('rejects points without a finite value', () => {
  const request = {
    resourceMetrics: [
      { scopeMetrics: [{ metrics: [{ name: 'm', gauge: { dataPoints: [{ asDouble: 'NaN' }, {}, { asDouble: 1 }] } }] }] },
    ],
  };
  const { rows, rejected } = parseOtlpMetrics(request, scope, now);
  assert.equal(rows.length, 1);
  assert.equal(rejected, 2);
});

test('uses the receive time when a point has no timestamp', () => {
  const request = { resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'm', gauge: { dataPoints: [{ asInt: 3 }] } }] }] }] };
  assert.equal(parseOtlpMetrics(request, scope, now).rows[0]?.timestamp, '2026-09-14 12:00:00.000');
});

test('rejects bodies that are not OTLP requests', () => {
  assert.throws(() => parseOtlpMetrics([], scope), /OTLP/);
  assert.throws(() => parseOtlpMetrics({ resourceMetrics: {} }, scope), /OTLP/);
  assert.deepEqual(parseOtlpMetrics({}, scope), { rows: [], rejected: 0 });
});
