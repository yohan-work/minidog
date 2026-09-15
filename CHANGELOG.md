# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may change behaviour).

## [Unreleased]

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

[Unreleased]: https://github.com/yohan-work/minidog/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yohan-work/minidog/releases/tag/v0.1.0
