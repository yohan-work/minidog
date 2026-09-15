<div align="center">

# minidog

**Self-hosted observability for side projects.**<br>
Metrics, traces, logs and uptime checks in one dashboard, built on OpenTelemetry and ClickHouse.

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![한국어](https://img.shields.io/badge/lang-한국어-lightgrey)](README.ko.md)

![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-native-425CC7?logo=opentelemetry&logoColor=white)
![ClickHouse](https://img.shields.io/badge/ClickHouse-26.3-FFCC01?logo=clickhouse&logoColor=black)

</div>

---

<img width="1899" height="917" alt="스크린샷 2026-09-14 오후 5 47 22" src="https://github.com/user-attachments/assets/343b2aac-52bf-49f3-8d49-dee3c58d9c0d" />


minidog takes the core Datadog workflow and scales it down for solo developers and small teams:

> **Something is slow → which service → which endpoint → which span → which log line.**

The goal is to reach the root cause in three screens or fewer, without first learning a query language.

## Features

- **Overview**: health of every service at a glance, with a *needs attention* list that points at the problem.
- **APM**: requests, error rate and P50/P95/P99 for each service and endpoint, a trace explorer and a span waterfall. Deployments (a new `service.version`) are marked on the charts, with a per-version comparison on the service page. Each endpoint has its own page with a response-time distribution (logarithmic buckets) and its slowest requests.
- **Logs**: search and filter by service and level. Log lines that carry a trace ID link to that trace; live tail streams new records as they arrive.
- **Correlation**: trace → related logs and log → trace, carrying the time range and filters across pages. Drag across a request or latency chart to open that window's slowest traces, error traces, error logs or exceptions.
- **Errors**: exceptions recorded on spans, grouped by type and message, with affected traces, endpoints, first and last seen.
- **Database queries**: statements from database client spans ranked by time spent, P95 or calls, with literals replaced by `?`; each opens its slowest call.
- **Infrastructure**: host CPU, memory, disk and network through the OTel `hostmetrics` receiver.
- **Metrics Explorer**: query any ingested metric with aggregation and filters.
- **Synthetics**: HTTP checks with status, latency, availability and SSL expiry; they can follow redirects and require text in the response body.
- **Monitors**: alerts for service down, error rate, latency, host resources and synthetic checks (failed checks, response time, SSL expiry), with Warning and Critical levels, state history and webhooks (Slack-compatible). Noise control: alert only after a condition lasts N minutes, delay recovery, and mute notifications during maintenance.
- **Service Map**: a dependency graph built from span relationships.
- **Projects**: projects, environments and ingest API keys.
- **Themes**: dark (default), light, or follow the system; the switch is at the bottom of the sidebar.
- **Search**: ⌘K / Ctrl+K from anywhere finds pages, services, endpoints, hosts and monitors, opens a pasted trace id, or searches logs and traces for the typed text.

## Quick start

Requirements: Node.js 24+, pnpm 10 and Docker.

```bash
git clone https://github.com/yohan-work/minidog.git
cd minidog
pnpm install

pnpm infra:up   # ClickHouse + OpenTelemetry Collector
pnpm dev        # API on :4000, dashboard on :3000
```

Open **http://localhost:3000**. Host metrics start arriving within about 15 seconds.

### Always-on mode

To keep minidog running without a terminal, run the API and dashboard in Docker instead of `pnpm dev`:

```bash
pnpm local:up     # builds and starts everything; restarts whenever Docker starts
pnpm local:logs   # follow API / dashboard logs
pnpm local:down   # stop it (e.g. to go back to pnpm dev)
```

It uses the same data as `pnpm dev` (`apps/api/data` and the ClickHouse volume), so run one or the other; the API refuses to start while the port is taken. After pulling new code, run `pnpm local:up` again to rebuild. Turn on Docker Desktop's *Start Docker Desktop when you sign in* to have it come back after a reboot. Checks pause while the Mac sleeps.

### Try it with demo data

```bash
pnpm demo
```

This starts three instrumented services (`web → api → payment`, backed by a simulated Postgres) that generate traffic. You can break them at runtime to see how the dashboard reacts:

```bash
# slow database + 20% payment errors
curl -X POST localhost:5100/__demo/scenario -d '{"slowDb":true,"paymentErrorRate":0.2}'
```

## Send your own telemetry

minidog accepts standard OTLP, so you don't need a vendor SDK. Point any OpenTelemetry SDK at the bundled Collector:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-api
```

For Node.js, zero-code auto-instrumentation works out of the box:

```bash
npm i @opentelemetry/auto-instrumentations-node
node --require @opentelemetry/auto-instrumentations-node/register app.js
```

Without an API key, data goes to the default project. To send it to a specific project and environment, create a key in **Settings** and send it with every request:

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-minidog-api-key=<your-key>"
```

`Authorization: Bearer <key>` is accepted too. Set `INGEST_REQUIRE_API_KEY=true` to reject data that arrives without a key.

## Architecture

```text
Your app ──OTLP──▶ OTel Collector ──OTLP/HTTP──▶ Ingestion API ──▶ ClickHouse
                   (+ host metrics)              (Fastify)          (spans, logs,
                                                     │               metrics, checks)
                                                     ├── SQLite (projects, monitors, keys)
                                                     ├── Synthetic worker
                                                     └── Alert evaluator
                                                     ▲
                                  Next.js dashboard ─┘  Query API
```

| Data | Store | Retention |
| --- | --- | --- |
| Spans, logs | ClickHouse | 14 days |
| Metrics | ClickHouse | 30 days |
| Synthetic results | ClickHouse | 90 days |
| Projects, monitors, API keys | SQLite | — |

Tables are created automatically on first start.

## Project structure

```text
apps/
  api/          Fastify: OTLP ingestion, Query API, synthetic worker, alert evaluator
  web/          Next.js dashboard
packages/
  types/        Shared API types
  config/       Shared TypeScript config
examples/
  demo-shop/    Instrumented demo services with fault injection
infra/
  docker/       Docker Compose for ClickHouse + Collector
  otel/         Collector pipeline config
  clickhouse/   ClickHouse server config
docs/           Product and design spec
```

## Configuration

Both apps work without any configuration; the defaults match `infra/docker/compose.yaml`. To override them, copy `apps/api/.env.example` and `apps/web/.env.example` to `.env`.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `CLICKHOUSE_URL` | `http://127.0.0.1:8123` | ClickHouse HTTP endpoint |
| `SQLITE_PATH` | `./data/minidog.sqlite` | Metadata database |
| `WORKER_ENABLED` | `true` | Run synthetic checks in the API process |
| `ALERTS_ENABLED` | `true` | Evaluate monitors in the API process |
| `ALERT_INTERVAL_SECONDS` | `30` | How often monitors are evaluated |
| `INGEST_REQUIRE_API_KEY` | `false` | Reject data sent without an API key |
| `API_URL` (web) | `http://127.0.0.1:4000` | Query API used by the dashboard |

## Development

```bash
pnpm typecheck   # all packages
pnpm test        # API unit tests
pnpm infra:logs  # follow ClickHouse / Collector logs
pnpm infra:down
```

The product and design spec is in [`docs/phase-01.md`](docs/phase-01.md).

## Roadmap

- [x] Synthetic monitoring
- [x] Infrastructure metrics
- [x] APM: services, endpoints, traces
- [x] Logs + trace correlation
- [x] Monitors and webhooks
- [x] Service map
- [ ] Baseline comparison ("P95 ↑ 312% vs last week")
- [ ] Heartbeat / cron monitors
- [ ] Slack, Discord and email notifications
- [ ] Command menu (jump to trace ID)
