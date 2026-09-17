# Getting started

[한국어](getting-started.ko.md)

This guide covers the ways to run minidog, how to send it data, how to get alerts on your phone, and a short tour you can follow with the demo shop.

## Ways to run it

| | Best for | Command |
|---|---|---|
| **Published images** | Using minidog | `docker compose up -d` with [`deploy/compose.yaml`](../deploy/compose.yaml) |
| **From source** | Changing minidog | `pnpm infra:up && pnpm dev` |
| **Always-on (from source)** | Running your own build without a terminal open | `pnpm local:up` |

### Published images

```bash
mkdir minidog && cd minidog
curl -fsSLO https://raw.githubusercontent.com/yohan-work/minidog/main/deploy/compose.yaml
docker compose up -d                    # add --profile demo for sample traffic
```

- Update: `docker compose pull && docker compose up -d`. Pin a release with `MINIDOG_VERSION=0.2.0 docker compose up -d`.
- Data lives in the `clickhouse-data` and `minidog-data` volumes. `docker compose down` keeps them; `docker compose down -v` deletes them.
- Forgot the password: `docker compose exec api node cli/reset-password.mjs`, then open the dashboard to set a new one.

### From source

Requires Node.js 24+, pnpm 10 and Docker.

```bash
git clone https://github.com/yohan-work/minidog.git
cd minidog
pnpm install
pnpm infra:up   # ClickHouse + OpenTelemetry Collector
pnpm dev        # API on :4000, dashboard on :3000
```

Forgot the password: `pnpm auth:reset`.

### Always-on mode

Runs the API and dashboard from source in Docker instead of `pnpm dev`, and restarts them whenever Docker starts:

```bash
pnpm local:up     # build and start
pnpm local:logs   # follow API and dashboard logs
pnpm local:down   # stop, e.g. to go back to pnpm dev
```

- It uses the same data (`apps/api/data` and the ClickHouse volume) and settings (`apps/api/.env`) as `pnpm dev`, so run one or the other. The API locks the data (`minidog.sqlite.lock`) and refuses to start while the other holds it. A lock left by a crash expires after 30 seconds.
- After pulling new code, run `pnpm local:up` again to rebuild.
- To have it come back after a reboot, turn on Docker Desktop's *Start Docker Desktop when you sign in*. Checks pause while the machine sleeps, and that time shows as *not measured*.

This section is for running your own build. On a server, the published images already restart with Docker (`restart: unless-stopped` in `deploy/compose.yaml`) and need nothing here.

## Sending data

| From | Setting |
|---|---|
| An SDK, through the bundled Collector | `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` |
| An SDK, straight to the API | `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4000`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` |
| Your own Collector | an `otlp_http` exporter with `endpoint: http://<api>:4000` and `encoding: json` |

- The API accepts OTLP/HTTP **JSON** only (gzip is fine). Protobuf requests get a 415; the bundled Collector converts for you.
- The service comes from the `service.name` resource attribute, the host from `host.name` and the environment from `deployment.environment.name`. A new `service.version` is shown as a deploy marker.

### API keys

Create keys per environment in **Settings → API keys**. A key is shown once and only its hash is stored.

- Send it as `x-minidog-api-key: <key>` or `Authorization: Bearer <key>`.
- To have the bundled Collector send a key, run `MINIDOG_API_KEY=<key> pnpm infra:up`, or set `MINIDOG_API_KEY` for `docker compose`.
- Data without a key goes to the default project, which is the first environment of the first project. With `INGEST_REQUIRE_API_KEY=true` it is rejected with a 401, and so are revoked or unknown keys.

### Host metrics on a Linux server

On Docker Desktop you see the Docker VM, not your Mac. To watch a real Linux host, mount `/:/hostfs:ro` into the Collector container, set `host_metrics.root_path: /hostfs` and use `network_mode: host`. The comments in [`infra/otel/collector.yaml`](../infra/otel/collector.yaml) show where.

## Alerts on your phone, for free

Put one of these in a monitor's **Webhook URL** and press **Send test**. minidog picks the right format from the address.

| Service | Setup | Webhook URL |
|---|---|---|
| ntfy (no account) | Install the ntfy app and subscribe to a hard-to-guess topic. Topics are public, so the name is the password. | `https://ntfy.sh/<topic>` |
| Discord | Channel settings → Integrations → Webhooks → New webhook → Copy URL | `https://discord.com/api/webhooks/…` |
| Telegram | Create a bot with @BotFather, message it, then find the chat id with `getUpdates`. | `https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>` |
| Slack | Add the Incoming Webhooks app | `https://hooks.slack.com/services/…` |

Any other URL receives a JSON POST with `text`, `monitor`, `state`, `message` and more.

**Email.** Set `SMTP_HOST` and `SMTP_FROM` on the API (and usually `SMTP_USER` / `SMTP_PASSWORD`). Port 587 uses STARTTLS; set `SMTP_SECURE=true` for implicit TLS on 465. Each monitor can then take an **Email** address (or several, comma-separated) next to its webhook — same Warning/Critical, delays and mutes — and **Send test** checks the address before anything alerts. Delivery status shows next to the webhook status in History.

**Daily summary.** In **Settings → Daily summary**, pick one of these URLs and a time of day. Once a day minidog sends uptime, response time and certificate days left for each monitor, alert changes, and time not measured. If the computer was off at that time, it sends when minidog starts again. On Mondays it can send a 7-day summary instead.

### Cron jobs that stop running

A backup that quietly stopped is the failure nobody notices. Create a monitor of type **Heartbeat**, set **Critical** to the job's period plus some slack (90 minutes for an hourly job, 26 hours for a nightly one), and minidog shows a ping URL with a crontab line to paste:

```
0 3 * * * /path/to/backup.sh && curl -fsS -m 10 --retry 3 http://<minidog>:4000/heartbeat/hb_… > /dev/null
```

The `&&` means the job only checks in when it succeeded. Any `GET` or `POST` to the URL counts, with or without a body, and it needs no sign-in: the token in the URL is the credential, so treat it like a password. When nothing has arrived for longer than the threshold the monitor turns Critical and notifies like any other; the next ping brings it back at once. The Monitor page shows how many pings have arrived and when the last one came.

Pings need to reach the API from wherever the job runs — on the same machine `http://localhost:4000` works; from elsewhere see [running it on a server](#running-it-on-a-server).

## Configuration

The API reads environment variables, or `apps/api/.env` when run from source (copy `.env.example`). With the published images, set them in `compose.yaml`.

| Variable | Default | What it does |
|---|---|---|
| `PORT` / `HOST` | `4000` / `127.0.0.1` | API address |
| `SQLITE_PATH` | `./data/minidog.sqlite` | Settings, monitors, keys and sessions |
| `CLICKHOUSE_URL`, `_USER`, `_PASSWORD`, `_DATABASE` | the compose values | Telemetry storage |
| `WORKER_ENABLED` | `true` | Run synthetic checks |
| `ALERTS_ENABLED` / `ALERT_INTERVAL_SECONDS` | `true` / `30` | Evaluate monitors, and how often |
| `INGEST_REQUIRE_API_KEY` | `false` | Reject OTLP data without a key |
| `AUTH_DISABLED` | `false` | Turn off sign-in. Only use it on a machine nobody else can reach. |
| `BLOCK_PRIVATE_TARGETS` | `false` | Also keep checks and webhooks off private and loopback networks, for shared servers |
| `HEARTBEAT_URL` | — | Pinged while minidog runs, so something else notices when it stops (see below) |
| `HEARTBEAT_INTERVAL_SECONDS` | `300` | How often that ping is sent |
| `PUBLIC_API_URL` / `PUBLIC_COLLECTOR_URL` | `http://localhost:4000` / `:4318` | Connection details shown in Settings |
| `SMTP_HOST` / `SMTP_FROM` | — | Enable alert emails (see below). Also `SMTP_PORT` (587), `SMTP_SECURE` (false), `SMTP_USER`, `SMTP_PASSWORD` |

The dashboard forwards `/api/*` to `API_URL` (default `http://127.0.0.1:4000`), read when each request arrives.

Retention defaults to 14 days for spans and logs, 30 days for metrics and 90 days for synthetic results. **Settings → Storage** shows disk use per signal and changes retention for all projects. Shortening it deletes older data right away.

## Running it on a server

Every port binds to `127.0.0.1`, so a fresh install answers only on the machine it runs on. Deleting that prefix to reach it from your laptop also publishes OTLP ingest, which takes data without a key by default. Two better ways:

**Tunnel to it, and publish nothing.** Leave the bindings alone and forward the port when you need it:

```bash
ssh -N -L 3000:127.0.0.1:3000 you@your-server   # then open http://localhost:3000
```

Tailscale, WireGuard or any VPN work the same way: as far as Docker is concerned, the dashboard is still on localhost.

**Put TLS in front, if it has to be public.** Terminate HTTPS at a reverse proxy and leave the rest closed:

```text
minidog.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Then, in `compose.yaml`:

- `INGEST_REQUIRE_API_KEY: true`, so only your own senders can write telemetry.
- `BLOCK_PRIVATE_TARGETS: true`, so a signed-in browser cannot aim checks or webhooks at the server's own network.
- `CLICKHOUSE_PASSWORD`: anything but the default.
- Leave `4317` and `4318` on localhost unless something off the machine sends OTLP — and then require a key.

The sign-in cookie is marked `Secure` when the proxy sets `X-Forwarded-Proto: https`. Caddy does that on its own; with nginx, add `proxy_set_header X-Forwarded-Proto $scheme;` to the location, or the cookie stays without it.

### When minidog itself is down

Alerts come from minidog, so none arrive while it is off: a laptop that slept, a container that died, a server that never came back. Give it a URL that notices silence, and it pings that URL while it runs:

```yaml
HEARTBEAT_URL: https://hc-ping.com/<uuid>   # healthchecks.io, an Uptime Kuma push URL, anything
HEARTBEAT_INTERVAL_SECONDS: 300
```

Set the other end to expect a ping a little less often than that — every 10 minutes for the 5-minute default — and it will tell you when minidog goes quiet.

The watcher may sit on your own network (an Uptime Kuma push URL, say): this ping is allowed there even with `BLOCK_PRIVATE_TARGETS` set, because you configure it, unlike the URLs a check or a webhook points at. What it proves is that the minidog process is running — not that ClickHouse is reachable, which the dashboard shows separately.

## Backing up

Two volumes hold everything. `minidog-data` is one small SQLite file: the password, sessions, API keys, projects, monitors, dashboards and alert history. `clickhouse-data` holds telemetry, which ages out on its own. The first is the one worth copying — losing it means setting everything up again and re-keying every sender.

```bash
day=$(date +%F)
docker compose exec api node cli/backup.mjs /data/minidog-$day.sqlite   # published images
docker cp minidog-api-1:/data/minidog-$day.sqlite .                     # copy it off the volume
pnpm db:backup ./minidog-$day.sqlite                                    # from source
```

Each backup needs a name of its own; the command refuses to overwrite a file, so a fixed name works once. Dating them also tells you how old one is.

This is safe while minidog runs: it writes a consistent snapshot, which copying a live SQLite file is not. Run it where minidog runs — from source, that means inside the container when you use `pnpm local:up`, since a snapshot taken across a bind mount can be torn. The command checks and says so.

To put a backup back, stop the API first. It holds a lock on the data, and the restore refuses while that lock is held:

```bash
docker compose stop api
docker compose run --rm -v "$PWD:/backup" api node cli/restore.mjs /backup/minidog-backup.sqlite
docker compose start api
```

From source, with minidog stopped: `pnpm db:restore ./minidog-backup.sqlite`.

### Telemetry too

Usually not worth it: spans and logs are kept for 14 days and metrics for 30 by default, so a backup is out of date before you need it, and the senders fill ClickHouse again on their own. If you have raised the retention and want to keep what is there, copy the volume with ClickHouse stopped. It writes to its data directory continuously; a copy taken while it runs can hold half-written parts that it refuses to load.

```bash
docker compose stop clickhouse api
docker run --rm -v minidog_clickhouse-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/clickhouse-$(date +%F).tgz -C /data .
docker compose start clickhouse api
```

Stopping the API with it is deliberate: exporters get a connection error instead of a 503 and retry, and the collector buffers what arrives in the meantime, so a minute's stop loses nothing that was sent. To restore, stop both again, empty the volume (`docker run --rm -v minidog_clickhouse-data:/data alpine sh -c 'rm -rf /data/*'`) and extract the archive into it the same way, then start them. The archive must come from the same ClickHouse major version. An archive from an older minidog is fine: the API adds the columns it needs when it starts.

`docker compose down` keeps both volumes; `docker compose down -v` deletes them.

## A tour with the demo shop

Start the demo (`docker compose --profile demo up -d`, or `pnpm demo` from source). It runs `web → api → payment` with a simulated Postgres. You can change its behaviour while it runs:

```bash
curl -X POST localhost:5100/__demo/scenario -d '{"dbDelayMs":300}'         # slower database
curl -X POST localhost:5100/__demo/scenario -d '{"paymentErrorRate":0.2}'  # 20% payment failures
curl -X POST localhost:5100/__demo/scenario -d '{"dbDelayMs":null,"slowDb":false,"paymentErrorRate":0.02}'  # back to normal
```

With the published images, port 5100 is only reachable inside Docker. Use `docker compose exec demo wget -qO- --post-data '{"dbDelayMs":300}' 127.0.0.1:5100/__demo/scenario`.

| Try | Steps |
|---|---|
| Uptime check | Synthetics → New monitor → `https://example.com`. The detail page shows status, uptime, latency and history. |
| Slow endpoint to span | Services → `api` → `POST /checkout` → a slow trace → the waterfall's slowest span |
| Error to log | Traces → Status: Errors → a trace → Related logs. The Logs page links back the other way. |
| Latency alert | Monitors → New monitor → Latency, `api`, warning 250 ms, critical 500 ms. Raise `dbDelayMs` to 200, then 600, and the history goes Healthy → Warning → Critical. |
| Drill down | Set `paymentErrorRate` to 0.5, then drag across the request chart on Services and open Exceptions. `card declined by issuer` is grouped in Errors. |
| Slow queries | With `dbDelayMs` at 300, Queries ranks `INSERT INTO orders …` first by time spent. Click it to open its slowest call. |
| Deploy marker | From source, restart with `DEMO_VERSION=1.1.0 pnpm demo`. Service charts show a `1.1.0` line, and Versions compares 1.0.0 with 1.1.0. |
| Live tail | Logs → **Live tail**. New lines appear every 2 seconds, and filters still apply. |
| Phone alert | Put `https://ntfy.sh/<topic>` in a monitor's Webhook URL → **Send test** |
| Not measured | Stop minidog for a few minutes, or let the machine sleep. The monitor's availability bar shows a hatched *not measured* stretch. |
| Search | Press ⌘K anywhere and type `checkout`. Pasting a 32-character trace id opens that trace. |
| Dashboard | Dashboards → New dashboard, then add synthetic monitors, service charts or metrics. **Add to dashboard** on Metrics works too. |
