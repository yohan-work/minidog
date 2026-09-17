/**
 * Seeds one recent trace and a linked log through the Ingestion API so the
 * dashboard has something to show. Used by the Playwright flow in CI.
 *
 *   node e2e/seed.mjs [apiBaseUrl]
 */
const api = (process.argv[2] ?? process.env.E2E_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

const TRACE = '5b8efff798038103d269b633813fc60c';
const SPAN = 'eee19b7ec3c1b174';
const now = Date.now();
const nanos = (ms) => String(BigInt(ms) * 1_000_000n);
const str = (key, value) => ({ key, value: { stringValue: value } });
const int = (key, value) => ({ key, value: { intValue: String(value) } });

async function post(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} → ${response.status}: ${text}`);
  }
}

await post('/v1/traces', {
  resourceSpans: [
    {
      resource: { attributes: [str('service.name', 'api'), str('service.version', 'e2e')] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: TRACE,
              spanId: SPAN,
              name: 'GET /health',
              kind: 2,
              startTimeUnixNano: nanos(now - 50),
              endTimeUnixNano: nanos(now),
              attributes: [
                str('http.request.method', 'GET'),
                str('http.route', '/health'),
                int('http.response.status_code', 200),
              ],
              status: { code: 1 },
            },
          ],
        },
      ],
    },
  ],
});

await post('/v1/logs', {
  resourceLogs: [
    {
      resource: { attributes: [str('service.name', 'api')] },
      scopeLogs: [
        {
          logRecords: [
            {
              timeUnixNano: nanos(now - 20),
              severityNumber: 9,
              severityText: 'INFO',
              body: { stringValue: 'e2e health check ok' },
              attributes: [str('route', '/health')],
              traceId: TRACE,
              spanId: SPAN,
            },
          ],
        },
      ],
    },
  ],
});

console.log(`seeded trace ${TRACE} into ${api}`);
