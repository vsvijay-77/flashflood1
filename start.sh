#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║         Flash Flood Digital Twin — Single Start Script       ║
# ║  Starts: Unified Backend (8001) · Frontend (3000)             ║
# ╚══════════════════════════════════════════════════════════════╝
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"
FRONTEND_PID_FILE="$LOG_DIR/frontend.pid"
BACKEND_PID_FILE="$LOG_DIR/backend.pid"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

banner() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()     { echo -e "${GREEN}✅ $1${NC}"; }
warn()   { echo -e "${YELLOW}⚠  $1${NC}"; }
err()    { echo -e "${RED}❌ $1${NC}"; }

wait_port() {
  local port=$1 name=$2 max=${3:-60} pid=${4:-} i started=$SECONDS
  for ((i=1; i<=max; i++)); do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN &>/dev/null; then
      ok "$name is up on :$port"
      return 0
    fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      echo ""
      err "$name exited before opening :$port. Check $LOG_DIR for the startup error."
      return 1
    fi
    printf "\r  ${YELLOW}waiting for $name on :$port ... %ds${NC}" "$((SECONDS - started))"
    sleep 3
  done
  echo ""
  err "$name did not start on :$port after $((max * 3))s"
  return 1
}

wait_http() {
  local url=$1 name=$2 max=${3:-60} i
  for ((i=1; i<=max; i++)); do
    if curl --silent --fail --max-time 2 "$url" >/dev/null; then
      ok "$name is responding"
      return 0
    fi
    printf "\r  ${YELLOW}waiting for $name response ... %ds${NC}" $((i * 2))
    sleep 2
  done
  echo ""
  err "$name did not return a successful response after $((max * 2))s"
  return 1
}

stop_listener() {
  local port=$1 name=$2 pids i
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    warn "Stopping existing $name listener on :$port"
    kill $pids 2>/dev/null || true
    for ((i=1; i<=10; i++)); do
      if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN &>/dev/null; then
        return 0
      fi
      sleep 1
    done
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      warn "Force-stopping unresponsive $name listener on :$port"
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

stop_tracked_process() {
  local pid_file=$1 name=$2 pid i
  [[ -f "$pid_file" ]] || return 0

  pid="$(<"$pid_file")"
  rm -f "$pid_file"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null || return 0

  warn "Stopping previous $name startup process"
  kill "$pid" 2>/dev/null || true
  for ((i=1; i<=5; i++)); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  kill -9 "$pid" 2>/dev/null || true
}

# ── Stop only processes occupying this app's ports ────────────────
banner "Checking backend files"
if [ -f "$ROOT/backend/check_local_files.py" ]; then
  "$ROOT/backend/venv/bin/python" "$ROOT/backend/check_local_files.py" || true
fi

banner "Checking application ports"
stop_tracked_process "$FRONTEND_PID_FILE" "frontend"
stop_tracked_process "$BACKEND_PID_FILE" "backend"
stop_listener 3000 "frontend"
stop_listener 8001 "backend"

# ── Start Services Concurrently ──────────────────────────────────
banner "Starting Frontend (Vite) on :3000"
echo "  -> Logs: $LOG_DIR/frontend.log"
ln -sfn ../node_modules/cesium/Build/Cesium "$ROOT/frontend/public/cesium" 2>/dev/null || true
(cd "$ROOT/frontend" && export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && exec ./node_modules/.bin/vite --configLoader native --port 3000 --strictPort --host 0.0.0.0 < /dev/null >> "$LOG_DIR/frontend.log" 2>&1) &
FRONTEND_PID=$!
printf '%s\n' "$FRONTEND_PID" > "$FRONTEND_PID_FILE"

banner "Starting Unified Backend (FastAPI + RAG) on :8001"
echo "  -> Logs: $LOG_DIR/backend.log"
(cd "$ROOT/backend" && exec venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8001 --reload \
  >> "$LOG_DIR/backend.log" 2>&1) &
BACKEND_PID=$!
printf '%s\n' "$BACKEND_PID" > "$BACKEND_PID_FILE"

# Wait for both services
wait_port 3000 "Frontend" 60 "$FRONTEND_PID"
wait_port 8001 "Unified Backend" 180 "$BACKEND_PID"
wait_http "http://127.0.0.1:3000/" "Frontend" 30
wait_http "http://127.0.0.1:8001/api/" "Unified Backend" 30

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}    All services are running!  ${NC}"
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}  Frontend:    http://localhost:3000${NC}"
echo -e "${GREEN}  Backend:     http://localhost:8001/api/ (Unified Port 8001)${NC}"
echo -e "${GREEN}  Logs:        .logs/backend.log | .logs/frontend.log${NC}"
echo -e "${GREEN}  Press Ctrl+C to stop all services${NC}"
echo -e "${GREEN}==========================================${NC}"

trap 'echo -e "\n${YELLOW}Stopping all services...${NC}"; kill ${BACKEND_PID:-} ${FRONTEND_PID:-} 2>/dev/null || true; [ -n "${FRONTEND_PID_FILE:-}" ] && rm -f "$FRONTEND_PID_FILE"; [ -n "${BACKEND_PID_FILE:-}" ] && rm -f "$BACKEND_PID_FILE"; exit 0' INT TERM

wait
