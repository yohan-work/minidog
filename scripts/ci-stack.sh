#!/usr/bin/env bash
# Starts ClickHouse (compose) and optionally the API / dashboard for CI.
# Usage: scripts/ci-stack.sh up-api|up|down
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/infra/docker/compose.yaml")
DATA="${CI_STACK_DATA:-/tmp/minidog-ci-stack}"
API_PID_FILE="$DATA/api.pid"
WEB_PID_FILE="$DATA/web.pid"
API_LOG="$DATA/api.log"
WEB_LOG="$DATA/web.log"

export CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://127.0.0.1:8123}"
export SQLITE_PATH="${SQLITE_PATH:-$DATA/minidog.sqlite}"
export HOST=127.0.0.1
export PORT=4000
export WORKER_ENABLED="${WORKER_ENABLED:-false}"
export ALERTS_ENABLED="${ALERTS_ENABLED:-false}"
export AUTH_DISABLED="${AUTH_DISABLED:-false}"
export LOG_LEVEL="${LOG_LEVEL:-warn}"
export API_URL="${API_URL:-http://127.0.0.1:4000}"

wait_http() {
  local url=$1
  local label=$2
  local n=${3:-90}
  for _ in $(seq 1 "$n"); do
    if curl -sf "$url" >/dev/null; then
      echo "$label is up"
      return 0
    fi
    sleep 1
  done
  echo "$label did not become ready: $url" >&2
  return 1
}

start_api() {
  mkdir -p "$DATA"
  "${COMPOSE[@]}" up -d --wait clickhouse
  (
    cd "$ROOT"
    pnpm --filter @minidog/api start >"$API_LOG" 2>&1 &
    echo $! >"$API_PID_FILE"
  )
  wait_http "http://127.0.0.1:4000/api/health" "API"
  for _ in $(seq 1 90); do
    body=$(curl -sf http://127.0.0.1:4000/api/health || true)
    if echo "$body" | grep -q '"clickhouse":"ok"'; then
      echo "ClickHouse reachable through API"
      echo "$body"
      echo "$body" | grep -q '"sqlite":"ok"'
      return 0
    fi
    sleep 1
  done
  echo "ClickHouse never became reachable through the API" >&2
  tail -n 50 "$API_LOG" >&2 || true
  return 1
}

start_web() {
  (
    cd "$ROOT"
    pnpm --filter @minidog/web build >"$DATA/web-build.log" 2>&1
    pnpm --filter @minidog/web start >"$WEB_LOG" 2>&1 &
    echo $! >"$WEB_PID_FILE"
  )
  wait_http "http://127.0.0.1:3000/" "Web"
}

cmd=${1:-}
case "$cmd" in
  up-api)
    start_api
    ;;
  up)
    start_api
    start_web
    ;;
  down)
    if [[ -f "$API_PID_FILE" ]]; then kill "$(cat "$API_PID_FILE")" 2>/dev/null || true; rm -f "$API_PID_FILE"; fi
    if [[ -f "$WEB_PID_FILE" ]]; then kill "$(cat "$WEB_PID_FILE")" 2>/dev/null || true; rm -f "$WEB_PID_FILE"; fi
    # Next may leave child processes; best-effort.
    pkill -f "next start --port 3000" 2>/dev/null || true
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
    ;;
  *)
    echo "Usage: $0 up-api|up|down" >&2
    exit 2
    ;;
esac
