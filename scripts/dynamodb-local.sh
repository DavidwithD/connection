#!/usr/bin/env bash
# Control the vendored DynamoDB Local server.
#
#   ./scripts/dynamodb-local.sh start|stop|status|reset|install
#
# Runs with -sharedDb so every client sees one database regardless of which
# credentials or region it signs with — without it, each distinct access key
# gets its own isolated database file, which is a confusing way to lose data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor/dynamodb-local"
JAR="$VENDOR/DynamoDBLocal.jar"
DATA="$ROOT/.dynamodb-data"
PIDFILE="$DATA/dynamodb-local.pid"
LOG="$DATA/dynamodb-local.log"
PORT="${DYNAMODB_LOCAL_PORT:-8000}"
DOWNLOAD_URL="https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz"

running() {
  [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

require_jar() {
  if [[ ! -f "$JAR" ]]; then
    echo "DynamoDB Local is not installed at $JAR" >&2
    echo "Run: npm run ddb:install" >&2
    exit 1
  fi
}

cmd_install() {
  if [[ -f "$JAR" ]]; then
    echo "Already installed: $JAR"
    return
  fi
  command -v java >/dev/null 2>&1 || { echo "java not found — DynamoDB Local needs a JRE (11+)." >&2; exit 1; }
  echo "Downloading DynamoDB Local…"
  mkdir -p "$VENDOR"
  tmp="$(mktemp -d)"
  curl -fsSL --max-time 300 -o "$tmp/ddb.tar.gz" "$DOWNLOAD_URL"
  tar -xzf "$tmp/ddb.tar.gz" -C "$VENDOR"
  rm -rf "$tmp"
  echo "Installed: $JAR"
}

cmd_start() {
  require_jar
  if running; then
    echo "Already running (pid $(cat "$PIDFILE")) on port $PORT"
    return
  fi
  command -v java >/dev/null 2>&1 || { echo "java not found — DynamoDB Local needs a JRE (11+)." >&2; exit 1; }
  mkdir -p "$DATA"

  # Fail loudly on a port clash rather than leaving a half-started server.
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is already in use by another process." >&2
    echo "Set DYNAMODB_LOCAL_PORT to pick a different port." >&2
    exit 1
  fi

  cd "$VENDOR"
  nohup java \
    -Djava.library.path="$VENDOR/DynamoDBLocal_lib" \
    -jar "$JAR" \
    -sharedDb \
    -dbPath "$DATA" \
    -port "$PORT" \
    >"$LOG" 2>&1 &
  echo $! >"$PIDFILE"

  # Wait for the port to accept connections before returning success.
  for _ in $(seq 1 50); do
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "DynamoDB Local listening on http://localhost:$PORT (pid $(cat "$PIDFILE"))"
      echo "  data: $DATA"
      echo "  log:  $LOG"
      return
    fi
    sleep 0.2
  done

  echo "Failed to start within 10s. Last log lines:" >&2
  tail -20 "$LOG" >&2 || true
  rm -f "$PIDFILE"
  exit 1
}

cmd_stop() {
  if ! running; then
    echo "Not running."
    rm -f "$PIDFILE"
    return
  fi
  pid="$(cat "$PIDFILE")"
  kill "$pid"
  for _ in $(seq 1 25); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PIDFILE"
  echo "Stopped (pid $pid)."
}

cmd_status() {
  if running; then
    echo "running — pid $(cat "$PIDFILE"), port $PORT"
  else
    echo "stopped"
    exit 1
  fi
}

cmd_reset() {
  # Destroys every local table and item. Local dev data only.
  if running; then cmd_stop; fi
  rm -f "$DATA"/*.db "$DATA"/*.log
  echo "Local database wiped. Run 'npm run ddb:start && npm run ddb:migrate' to rebuild."
}

case "${1:-}" in
  install) cmd_install ;;
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  reset)   cmd_reset ;;
  restart) cmd_stop; cmd_start ;;
  *) echo "usage: $0 {install|start|stop|restart|status|reset}" >&2; exit 2 ;;
esac
