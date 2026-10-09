#!/usr/bin/env bash

# Exit immediately on error
set -e

# Get current script directory (project root)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

MODE="${1:---real}"
if [ "$#" -gt 1 ]; then
    echo "Usage: ./dev.sh [--real|--fixture]"
    exit 1
fi
case "$MODE" in
    --real|--fixture) ;;
    --help|-h) echo "Usage: ./dev.sh [--real|--fixture] (default: --real)"; exit 0 ;;
    *) echo "Usage: ./dev.sh [--real|--fixture]"; exit 1 ;;
esac

echo "=========================================="
echo " Starting ISU-CAMP Backend & Frontend "
echo "=========================================="

# ==========================================
# Process and port helpers
# ==========================================

# Every descendant of a pid, deepest first, so a parent is never signalled
# before the child that inherited its listening socket.
descendants() {
    local pid="$1" child
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
        descendants "$child"
        echo "$child"
    done
    return 0
}

# Flask's reloader runs the app in a child process that inherits the listening
# socket. Signalling only the parent left that child alive holding port 5000
# under a pid that no longer existed, so the next run could not bind.
kill_tree() {
    local pid="$1" target
    for target in $(descendants "$pid") "$pid"; do
        kill "$target" 2>/dev/null || true
    done
    sleep 0.3
    for target in $(descendants "$pid") "$pid"; do
        kill -9 "$target" 2>/dev/null || true
    done
}

port_owner() {
    local port="$1"
    if command -v lsof >/dev/null 2>&1; then
        lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | head -n 1
    elif command -v ss >/dev/null 2>&1; then
        ss -lptnH "sport = :$port" 2>/dev/null |
            grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2
    fi
}

# This checkout's own dev servers, found by command line rather than by a
# recorded pid: pids are reused, so a stored one can name an unrelated process.
# Where /proc is available the match is confirmed against the process's working
# directory, because the backend is started with a relative script path and so
# its command line alone does not say which checkout it belongs to.
project_dev_pids() {
    local pid cwd
    for pid in $(ps -eo pid=,command= 2>/dev/null |
        grep -E 'app/services/database\.py|[/ ]vite( |$)|vite/bin' |
        grep -v grep | awk '{print $1}' || true); do
        if [ -r "/proc/$pid/cwd" ]; then
            cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
            case "$cwd" in
                "$PROJECT_DIR"|"$PROJECT_DIR"/*) echo "$pid" ;;
            esac
        else
            # No /proc (macOS): the path pattern is specific enough to this
            # project to act on, which is the same trade the Windows runner makes.
            echo "$pid"
        fi
    done
}

stop_project_dev_processes() {
    local pid stopped=0
    for pid in $(project_dev_pids); do
        if [ "${1:-}" != "quiet" ]; then
            echo "[PORTS] Stopping leftover pid $pid"
        fi
        kill_tree "$pid"
        stopped=$((stopped + 1))
    done
    if [ "$stopped" -gt 0 ]; then
        sleep 0.5
    fi
    return 0
}

# Vite runs with --strictPort, so a leftover dev server is a hard stop rather
# than a port bump. Reclaim the ports this script binds, but only from
# processes provably belonging to this checkout.
reset_dev_ports() {
    local port owner busy=""
    for port in "$@"; do
        if [ -n "$(port_owner "$port")" ]; then
            busy="$busy $port"
        fi
    done
    if [ -z "$busy" ]; then
        return 0
    fi

    echo "[PORTS] In use:$busy. Clearing a previous run..."
    stop_project_dev_processes

    for port in "$@"; do
        owner="$(port_owner "$port")"
        if [ -z "$owner" ]; then
            continue
        fi
        # Anything still holding the port is not ours to stop, so name it
        # rather than killing it.
        echo "[ERROR] Port $port is held by pid $owner, which is not a dev server from this folder."
        echo "[ERROR] It was left running. Stop it and re-run."
        exit 1
    done

    echo "[PORTS] Ports clear."
}

# Cleanup handler on SIGINT (CTRL+C) or SIGTERM
cleanup() {
    echo ""
    echo "Shutting down servers..."
    if [ -n "$BACKEND_PID" ]; then
        kill_tree "$BACKEND_PID"
    fi
    # A sweep as well: the pid above is only a starting point, since a parent
    # that has already gone no longer reaches its own children.
    stop_project_dev_processes quiet
}

trap cleanup EXIT
trap 'exit 130' SIGINT
trap 'exit 143' SIGTERM

require_command() {
    local command="$1"

    if ! command -v "$command" >/dev/null 2>&1; then
        echo "[ERROR] Required command not found: $command"
        exit 1
    fi
}

require_command npm

# Install frontend deps if node_modules missing
if [ ! -d "frontend/admin/node_modules" ]; then
    echo "[SETUP] Installing frontend dependencies..."
    cd frontend/admin && npm install && cd "$PROJECT_DIR"
fi

# Process-env variables override frontend/admin/.env in Vite.
if [ "$MODE" = "--fixture" ]; then
    export VITE_TEST_LOCAL_ADAPTER=true
    export VITE_API_MODE=local
    export VITE_MAP_FIXTURE=osm
    echo "[MODE] Fixture: local OSM demo data; Flask and database are not used."
    echo "[LOGIN] Fixture only: admin_justine / password123"
    # Only the frontend port: fixture mode never binds 5000, so a process there
    # is none of this script's business.
    reset_dev_ports 5173
    cd frontend/admin
    exec npm run dev -- --host localhost --port 5173 --strictPort
fi

export VITE_TEST_LOCAL_ADAPTER=false
export VITE_API_MODE=real
export VITE_MAP_FIXTURE=none
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://127.0.0.1:5000}"
echo "[MODE] Real: authenticated backend at $VITE_API_BASE_URL; database required."
echo "[LOGIN] Use a real backend account. Fixture credentials do not apply."

require_command python3
if [ ! -d "venv" ]; then
    echo "[SETUP] Creating virtual environment..."
    python3 -m venv venv
    echo "[SETUP] Installing Python dependencies..."
    venv/bin/pip install -r requirements.txt
fi

echo "[SETUP] Checking database connection..."
venv/bin/python app/services/check_db.py

# After the database check, so a port conflict never tears down a working
# previous run that this one could not have replaced anyway.
reset_dev_ports 5000 5173

# Start Backend
echo "[1/2] Starting Flask Backend on http://127.0.0.1:5000..."
venv/bin/python app/services/database.py &
BACKEND_PID=$!

# Start Frontend
echo "[2/2] Starting Admin Frontend on http://localhost:5173..."
cd frontend/admin
npm run dev -- --host localhost --port 5173 --strictPort
