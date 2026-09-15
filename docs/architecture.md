# Architecture

A map for contributors: what runs where, how data flows, and where to make a change.

```text
Your app ──OTLP──▶ OpenTelemetry Collector ──OTLP/HTTP JSON──▶ API (Fastify) ──▶ ClickHouse
                   (+ host metrics)                              │                 spans, logs,
                                                                 │                 metrics, checks
                                                                 ├── SQLite: projects, monitors,
                                                                 │   dashboards, sessions, settings
                                                                 ├── workers: synthetic checks,
                                                                 │   alerts, daily summary, gaps
Browser ──▶ Dashboard (Next.js) ──/api/* (proxy route)──────────▶┘  Query API
```

## Processes

| Piece | Where | What it does |
|---|---|---|
| Collector | `infra/otel/collector.yaml` | Receives OTLP on 4317/4318, scrapes host metrics, forwards everything to the API as OTLP/HTTP JSON. |
| API | `apps/api` | One Fastify process. It runs OTLP ingest (`/v1/*`), the Query API (`/api/*`) and the background workers. |
| Dashboard | `apps/web` | Next.js App Router. Every page is a client component that polls the Query API. `app/api/[...path]/route.ts` forwards `/api/*` to `API_URL` at request time. |
| ClickHouse | `infra/clickhouse` | Telemetry storage. It uses the low-memory profile in `config.d/low-memory.xml`. |
| SQLite | `apps/api/data/minidog.sqlite` | Everything that is not telemetry: projects, API keys, monitors, alert state, dashboards, sessions and settings. |

## The API (`apps/api/src`)

- `app.ts` builds everything: repositories, services and workers go into one `AppContext`, and all routes are registered in one plugin, where the auth guard runs.
- `routes/`: one file per area. Request validation uses zod schemas. Errors are `HttpError`s and turn into `{ error: { code, message, details } }`.
- `services/`: logic that spans repositories, such as the APM rollups, alert state, HTTP checks, webhooks, auth and summaries.
- `repositories/`: one class per table. ClickHouse repositories extend `ClickHouseRepository`, and SQLite ones take a `DatabaseSync`.
- `worker/`: timers.
  - `synthetic-scheduler`: one timer per check.
  - `alert-evaluator`: evaluates monitors every 30 s.
  - `summary-scheduler`: sends the daily summary.
  - `gap-tracker`: detects sleep and downtime.
- `ingest/`: OTLP JSON → table rows.
- `db/`: schema. **Migrations are append-only**:
  - SQLite: numbered strings in `db/sqlite.ts`, applied by `user_version`.
  - ClickHouse: `CREATE … IF NOT EXISTS` and `ALTER … ADD COLUMN IF NOT EXISTS` in `db/clickhouse.ts`.

  Never edit a shipped migration; add a new one.
- `lib/network-guard.ts`: every outbound request from checks and webhooks goes through it.

## The dashboard (`apps/web`)

- `app/*/page.tsx` are thin; the screens live in `features/<area>/`.
- `lib/use-api.ts` polls, and `lib/api-client.ts` adds the `x-minidog-request` header and sends a 401 to `/login`.
- `components/observability/` holds the charts (uPlot) and state components.
- Styling is SCSS modules on CSS variables (`styles/tokens`), with light and dark themes.

## Where to change what

| You want to… | Touch |
|---|---|
| Add an alert monitor type | `packages/types` (`ALERT_MONITOR_TYPES`, defaults), `worker/alert-evaluator.ts` (`measure`), `routes/alerting.ts`, `features/monitors/NewAlertMonitorView.tsx` |
| Add a Query API route | a file in `routes/`, register it in `app.ts`, add types to `packages/types`, add a test with `app.inject` |
| Store a new setting | the `settings` table through a small repository (see `summary-repository.ts`) |
| Add a telemetry column | a new `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `db/clickhouse.ts`, the ingest mapper and the repository query |
| Add a webhook format | `services/webhook.ts` (`webhookFormat`, `webhookRequest`) and its test |
| Change the install | `deploy/compose.yaml`. Its inline configs must match `infra/` (`pnpm check:deploy`). |

## Testing

- `pnpm test` runs `node:test` through tsx. API tests talk to real SQLite (`:memory:`).
- Route tests build the whole app with a stub ClickHouse client and call it with `app.inject`; `routes/auth.test.ts` is the model.
- Web tests cover pure logic in `apps/web/lib`.

## Security model

- A session cookie (HttpOnly, SameSite=Lax) is required for every `/api/*` route except health and sign-in. The guard checks the route the router matched, not the raw URL.
- Requests that change data need `x-minidog-request: 1`, which cross-site forms cannot send.
- A password guess limit is shared by sign-in and password changes.
- Outbound checks and webhooks go through `network-guard` (see [SECURITY.md](../SECURITY.md)).
