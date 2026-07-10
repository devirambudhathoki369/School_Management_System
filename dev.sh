#!/usr/bin/env bash
# One-command dev runner: database, API and frontend with a tidy banner.
#   ./dev.sh            start everything (Ctrl-C stops it all)
#   ./dev.sh --no-open  don't open the browser
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PG_BIN=/usr/lib/postgresql/18/bin
PG_DATA="$HOME/.local/share/school_management_pg"
LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

BOLD=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'
YELLOW=$'\033[33m'; RESET=$'\033[0m'

say()  { printf '%s\n' "$*"; }
step() { printf '%s▸%s %s' "$CYAN" "$RESET" "$1"; }
ok()   { printf ' %s✓%s\n' "$GREEN" "$RESET"; }

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# --- database ---------------------------------------------------------------
step "PostgreSQL"
if ! "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$LOG_DIR/postgres.log" start >/dev/null
fi
ok

# --- ports ------------------------------------------------------------------
API_PORT=8000
port_free "$API_PORT" || API_PORT=8001
port_free "$API_PORT" || { say "${YELLOW}Ports 8000 and 8001 are both busy — free one and retry.${RESET}"; exit 1; }
WEB_PORT=5173
if ! port_free "$WEB_PORT"; then
  say "${YELLOW}Port $WEB_PORT is busy (a stale dev server?). Stop it and retry:${RESET}"
  say "  ${DIM}fuser -k $WEB_PORT/tcp${RESET}"
  exit 1
fi

# --- backend ----------------------------------------------------------------
cd "$ROOT/backend"
step "Migrations"
uv run python manage.py migrate --no-input >"$LOG_DIR/migrate.log" 2>&1
ok
step "API on :$API_PORT"
uv run python manage.py runserver "127.0.0.1:$API_PORT" >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!
ok

# --- frontend ---------------------------------------------------------------
cd "$ROOT/frontend"
step "Frontend on :$WEB_PORT"
API_PROXY="http://127.0.0.1:$API_PORT" npm run dev -- --port "$WEB_PORT" --strictPort \
  >"$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!
ok

cleanup() {
  say ""
  step "Shutting down"
  kill "$WEB_PID" "$API_PID" 2>/dev/null || true
  wait "$WEB_PID" "$API_PID" 2>/dev/null || true
  ok
}
trap cleanup EXIT INT TERM

# --- wait for health ----------------------------------------------------------
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$WEB_PORT/health/" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

say ""
say "  ${BOLD}School ERP is running${RESET}"
say ""
say "  ${BOLD}App${RESET}        ${CYAN}http://localhost:$WEB_PORT${RESET}"
say "  ${BOLD}API docs${RESET}   ${CYAN}http://127.0.0.1:$API_PORT/api/docs/${RESET}"
say "  ${DIM}Logs in .dev-logs/ · Ctrl-C stops everything${RESET}"
say ""
say "  ${BOLD}Demo logins (CentIT Academy)${RESET}"
say "  ${DIM}Admin    ${RESET} Gyanmala    / Demo-Pass-2082!"
say "  ${DIM}Parent   ${RESET} 9809763882  / Mero-Naya-Password-1"
say "  ${DIM}Student  ${RESET} Nirmals     / Laxmi-Demo-2083!"
say ""

if [[ "${1:-}" != "--no-open" ]] && command -v xdg-open >/dev/null; then
  xdg-open "http://localhost:$WEB_PORT" >/dev/null 2>&1 || true
fi

wait "$API_PID" "$WEB_PID"
