#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-agno"
PYTHON_BIN="$VENV_DIR/bin/python"
UI_DIR="$ROOT_DIR/apps/agent-ui"
PORT="${AGNO_PORT:-7777}"
UI_PORT="${AGNO_UI_PORT:-3000}"

bootstrap_only="false"
server_only="false"
ui_only="false"

for arg in "$@"; do
  case "$arg" in
    --bootstrap-only) bootstrap_only="true" ;;
    --server-only) server_only="true" ;;
    --ui-only) ui_only="true" ;;
  esac
done

run_step() {
  local workdir="$1"
  shift
  echo ">> $*"
  (cd "$workdir" && "$@")
}

if [[ ! -d "$VENV_DIR" ]]; then
  run_step "$ROOT_DIR" python3 -m venv "$VENV_DIR"
fi

run_step "$ROOT_DIR" "$PYTHON_BIN" -m pip install -r "$ROOT_DIR/python/requirements.txt"

if [[ ! -f "$ROOT_DIR/dist/cli.mjs" ]]; then
  run_step "$ROOT_DIR" bun run build
fi

if [[ ! -d "$UI_DIR/node_modules" ]]; then
  run_step "$UI_DIR" npm install
fi

if [[ -f "$UI_DIR/.env.local.example" && ! -f "$UI_DIR/.env.local" ]]; then
  cp "$UI_DIR/.env.local.example" "$UI_DIR/.env.local"
fi

if [[ "$bootstrap_only" == "true" ]]; then
  echo "Bootstrap concluido."
  exit 0
fi

if [[ "$server_only" == "true" ]]; then
  cd "$ROOT_DIR"
  AGNO_HOST="127.0.0.1" AGNO_PORT="$PORT" AGNO_UI_PORT="$UI_PORT" "$PYTHON_BIN" "$ROOT_DIR/python/agno_server.py"
  exit 0
fi

if [[ "$ui_only" == "true" ]]; then
  cd "$UI_DIR"
  npm run clean
  NEXT_PUBLIC_AGENT_OS_ENDPOINT="http://127.0.0.1:$PORT" npm exec next dev -- --hostname 127.0.0.1 -p "$UI_PORT"
  exit 0
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

(
  cd "$ROOT_DIR"
  AGNO_HOST="127.0.0.1" AGNO_PORT="$PORT" AGNO_UI_PORT="$UI_PORT" "$PYTHON_BIN" "$ROOT_DIR/python/agno_server.py"
) &
SERVER_PID=$!

echo "AgentOS: http://127.0.0.1:$PORT"
echo "Agent UI: http://127.0.0.1:$UI_PORT"
cd "$UI_DIR"
npm run clean
NEXT_PUBLIC_AGENT_OS_ENDPOINT="http://127.0.0.1:$PORT" npm exec next dev -- --hostname 127.0.0.1 -p "$UI_PORT"
