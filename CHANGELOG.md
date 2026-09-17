# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may change behaviour).

## [Unreleased]

### Added

- **Logs filter by attribute.** An Attributes section above the records lists the keys the matching records carry and the commonest values of each, with counts for the current filters; clicking a value narrows the records to it, and each attribute in an expanded record is a button that does the same. Up to five at once, as `?attr=key:value` in the URL, so a view can be shared.
- **The waterfall folds and searches.** Spans with children collapse to one row that says how many it hides, with Collapse all and Expand all above; a search box keeps the spans whose service, name, route or status message match, plus the path down to each of them.

### Changed

- While a window dragged on a chart is in force, the time range control in the top bar shows that window instead of the preset it replaced. Choosing a preset clears it, as before.

- Telemetry is written with ClickHouse's asynchronous inserts: the rows of each OTLP export are collected in memory and written as one part per table per flush, instead of a new part every time a collector pipeline exports. The API still waits for the flush before answering, so a 200 means the data is on disk and exporters retry on anything else.
- Opening a trace looks for its spans and logs in the days around when it happened, using the moment the link was made from (`?at=`), instead of across the whole retention. A pasted URL without it still searches everything.
- The dashboard shares one request and one timer per API path across the components showing it, and keeps the last response of screens you leave, so coming back shows them at once while the fresh load runs.

## [0.2.0] - 2026-09-16

What happens after the install: the first ten minutes with minidog, and the first few months of leaving it running.

### Added

- **Backup and restore.** `backup` copies the metadata database — password, API keys, projects, monitors, dashboards, alert history — while minidog runs; `restore` puts one back. A restore stages the file and swaps it in with a rename, keeps what it replaced as `.bak`, and refuses anything that is not a minidog database, so an interrupted or mistaken restore cannot lose the data it was meant to protect. `pnpm db:backup` / `pnpm db:restore`, or `node cli/backup.mjs` in the image.
- **A heartbeat for minidog itself.** Alerts come from minidog, so none arrive while it is off. With `HEARTBEAT_URL` set it pings a service that notices silence — healthchecks.io, an Uptime Kuma push URL — every `HEARTBEAT_INTERVAL_SECONDS` (300 by default). This one URL is exempt from `BLOCK_PRIVATE_TARGETS`, because the watcher is usually on the same network and you configure the address yourself; metadata and link-local addresses stay blocked, and checks and webhooks are unchanged.
- **Everything a repository needs to be contributed to**, first shipped after v0.1.0 was tagged: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, `docs/architecture.md`, a Korean guide, and rewritten READMEs in both languages.
- A recording of the core flow at the top of both READMEs: a degraded service, a drag across its latency spike, the slowest trace in that window, and its logs.
- **Guide sections for running it on a server** (a tunnel or TLS in front, and what else to change instead of publishing OTLP ingest) **and for backing up**. Both READMEs link to them, in English and Korean.
- Container logs are capped at 3 × 10 MB per service in both compose files, so a machine left running for months cannot fill its disk with them.
- Starting an older image against a newer database now refuses, naming both schema versions, instead of running quietly against a schema it does not know.
- Lint and formatting run in CI (Biome), with every rule exception and its reason recorded in `biome.jsonc`.

### Fixed

- The product suggested commands a Docker install does not have: the setup hints said `pnpm demo` and `pnpm infra:up`. They now show `docker compose --profile demo up -d`, with the source commands as the alternative.
- Setup snippets hardcoded their addresses — `http://localhost:4318` for the collector, a placeholder for the API — wrong for any other port or host. They now show the addresses the server reports, with a copy button. Settings → Connection also offered only the `pnpm` form of the collector's API key setting; it now gives the compose one first.
- Creating a synthetic check notified nobody: the alert was a separate trip to another screen. The form now offers **Alert me when this check fails**, on by default, with an optional webhook.
- The Overview's setup instructions disappeared about fifteen seconds after the first start, when the bundled collector reported the machine. They stay until something of yours is connected.
- On a phone, eight of the twelve navigation items sat off-screen with nothing to show the strip scrolls.
- A slow or unreachable ClickHouse stopped the dashboard and the collector from starting at all: `/api/health` answered 503, and both wait for the API to be healthy. Health is now liveness — 200 while the API serves, with the ClickHouse state in the body — and the check is bounded at 1.5 s.
- A full disk could end the API from a timer and leave the restart policy repeating it forever. Measurement-gap writes are guarded, and a failed write no longer loses the wake time that keeps a just-woken machine from reporting false downtime.
- Startup failures printed nothing useful and could leave the data lock behind for thirty seconds. They now say what happened and release the lock.
- The alert history's state arrow carried a label screen readers ignored.

## [0.1.0] - 2026-09-15

First public release.

### Added

- One-file install: `deploy/compose.yaml` with published images `ghcr.io/yohan-work/minidog-{api,web,demo}` for amd64 and arm64, plus a demo profile.
- APM: services, endpoints, traces, errors, slow database queries, service map and deploy markers from any OpenTelemetry SDK.
- Logs with search, trace correlation and live tail.
- Host metrics and a metrics explorer.
- Synthetic checks with redirects, required response text, SSL expiry and measurement gaps for sleep and downtime.
- Monitors for error rate, latency, service down, host resources and synthetic checks. Alerts go to Slack, Discord, Telegram and ntfy, and there is an optional daily summary.
- Dashboards, ⌘K search, light and dark themes, and retention per signal.
- Sign-in with a password set on first run, sessions, a guessing limit, and protection against cross-site requests.
- Outbound guard: checks and webhooks never reach link-local or metadata addresses; set `BLOCK_PRIVATE_TARGETS` to also block private networks.
- Low-memory ClickHouse profile; about 440 MB for the whole stack.

[Unreleased]: https://github.com/yohan-work/minidog/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yohan-work/minidog/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yohan-work/minidog/releases/tag/v0.1.0
