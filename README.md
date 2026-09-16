<div align="center">

# minidog

**Self-hosted observability for one developer's side projects.**<br>
Uptime checks, traces, logs, metrics and phone alerts in one Docker Compose file, built on OpenTelemetry and ClickHouse.

[![Release](https://img.shields.io/github/v/release/yohan-work/minidog)](https://github.com/yohan-work/minidog/releases)
[![CI](https://github.com/yohan-work/minidog/actions/workflows/ci.yml/badge.svg)](https://github.com/yohan-work/minidog/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-native-425CC7?logo=opentelemetry&logoColor=white)](https://opentelemetry.io)

[English](README.md) · [한국어](README.ko.md)

</div>

<img width="960" height="540" alt="minidog demo: a degraded service on the overview, a drag across its latency spike, the slowest trace in that window, and the trace's logs" src="docs/assets/demo.gif" />

## Why

You have a few side projects. You want to know when one goes down, and when it is slow, *why*. That usually means stitching together an uptime checker, a log viewer and a hosted APM with a free tier that runs out.

minidog is one install that answers both questions:

> **Something is slow → which service → which endpoint → which span → which log line.**

- **One file to install.** `docker compose up -d`, set a password, done. No agent per host, no account.
- **OpenTelemetry in, no vendor SDK.** Anything that speaks OTLP works: Node, Python, Go, Java or a Collector you already run.
- **Built for a laptop.** Time when your computer was asleep or minidog was off shows as *not measured*, not as downtime, so you don't get false alerts after opening the lid.
- **Alerts on your phone for free.** Slack, Discord, Telegram or an [ntfy](https://ntfy.sh) topic, plus an optional daily summary.

## Quick start

Docker is the only requirement.

```bash
mkdir minidog && cd minidog
curl -fsSLO https://raw.githubusercontent.com/yohan-work/minidog/main/deploy/compose.yaml
docker compose up -d
```

Open **http://localhost:3000** and set a password. Host metrics arrive within about 15 seconds. To see traces, logs and errors right away, start the demo shop, three services sending sample traffic:

```bash
docker compose --profile demo up -d
```

To update, run `docker compose pull && docker compose up -d`. To pin a release, set `MINIDOG_VERSION=0.2.0`.

## What you get

| | |
|---|---|
| **Synthetics** | HTTP checks with status, latency, uptime and SSL expiry. They can follow redirects and require text in the body. |
| **APM** | Services, endpoints, P50/P95/P99, traces with a span waterfall, a service map and deploy markers per `service.version`. |
| **Errors and queries** | Exceptions grouped by type and message. Slow database statements, ranked with their values replaced by `?`. |
| **Logs** | Search and live tail. Log lines link to their traces, and traces link back to their logs. |
| **Infrastructure** | Host CPU, memory, disk and network from the Collector, plus a metrics explorer. |
| **Monitors** | Error rate, latency, service down, host resources and failed checks, with Warning and Critical levels. You can wait N minutes before alerting and mute during maintenance. |
| **Everyday use** | Dashboards, ⌘K search, drag across a chart to see that window's slowest traces, light and dark themes, and retention per signal. |

The [getting started guide](docs/getting-started.md) walks through each one with the demo shop.

## Send your own telemetry

Point any OpenTelemetry SDK at the bundled Collector:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-api
```

For Node.js, zero-code auto-instrumentation works out of the box:

```bash
npm i @opentelemetry/auto-instrumentations-node
node --require @opentelemetry/auto-instrumentations-node/register app.js
```

Data without an API key goes to the default project. To route it to a project and environment, create a key in **Settings** and send it as `x-minidog-api-key` in `OTEL_EXPORTER_OTLP_HEADERS`.

## Resource use

Measured on an Apple-silicon Mac with Docker Desktop, one minute after start, using the bundled low-memory ClickHouse settings:

| | Memory | Image (compressed) |
|---|---|---|
| Dashboard | 42 MB | 68 MB |
| API | 45 MB | 57 MB |
| ClickHouse | 300 MB, capped at 1 GiB | 234 MB |
| OpenTelemetry Collector | 51 MB | — |

That is about 440 MB in total, and ClickHouse can grow to its 1 GiB ceiling as data and queries grow. This is not a tiny agent.

## Is it for you?

minidog is for **one person watching a handful of projects**. It is not for teams: there are no users, roles or SSO. It is not meant to be exposed to the internet either; it listens on localhost by default. Better choices for other needs:

- **Only uptime checks:** [Uptime Kuma](https://github.com/louislam/uptime-kuma) is lighter and has far more notification types.
- **Only server metrics:** [Beszel](https://github.com/henrygd/beszel) is a small agent and hub.
- **A team, or production at scale:** [SigNoz](https://github.com/SigNoz/signoz) and [HyperDX](https://github.com/hyperdxio/hyperdx) are full observability platforms on the same stack.

## Security

The first visit sets a password, and every page and the Query API require sign-in. Every port binds to 127.0.0.1. Checks and webhooks never reach link-local or cloud metadata addresses. Forgot the password? Run `docker compose exec api node cli/reset-password.mjs`. See [SECURITY.md](SECURITY.md) for the model and how to report a vulnerability, and the guide for [reaching minidog from another machine](docs/getting-started.md#running-it-on-a-server) without publishing it to the internet.

## Keeping it

Your password, API keys, monitors and dashboards live in one small SQLite file; telemetry lives in ClickHouse and ages out on its own. Copy that file at any time, including while minidog is running:

```bash
docker compose exec api node cli/backup.mjs /data/minidog-$(date +%F).sqlite
```

Details, and how to put it back, are in [Backing up](docs/getting-started.md#backing-up). Note that `docker compose down -v` deletes both volumes — everything, not just the telemetry.

## Documentation

- [Getting started](docs/getting-started.md): configuration, always-on mode, running from source, the demo shop and phone alerts.
- [Architecture](docs/architecture.md): how the pieces fit and where to change what.
- [Contributing](CONTRIBUTING.md), [changelog](CHANGELOG.md), [code of conduct](CODE_OF_CONDUCT.md).

## Roadmap

- [ ] Heartbeat / cron monitors: alert when a job stops checking in
- [ ] Baseline comparison: "P95 ↑ 312% vs last week"
- [ ] LLM calls: token and cost views from OpenTelemetry `gen_ai` spans

Ideas and votes are welcome in [issues](https://github.com/yohan-work/minidog/issues).

## License

[MIT](LICENSE). minidog is an independent project and is not affiliated with Datadog.
