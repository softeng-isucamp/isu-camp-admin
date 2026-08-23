#!/usr/bin/env bash

# Exit immediately on error
set -e

# Get current script directory (project root)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "=========================================="
echo " Starting ISU-CAMP Backend & Frontend "
echo "=========================================="

# Cleanup handler on SIGINT (CTRL+C) or SIGTERM
cleanup() {
    echo ""
    echo "Shutting down servers..."
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

require_command() {
    local command="$1"

    if ! command -v "$command" >/dev/null 2>&1; then
        echo "[ERROR] Required command not found: $command"
        exit 1
    fi
}

# Free ports used by the backend/frontend so stale instances can't squat on them
free_port() {
    local port="$1"
    local pids
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
        echo "[SETUP] Killing stale process(es) on port $port: $pids"
        kill $pids 2>/dev/null || true
        sleep 1
    fi
}

free_port 5000
free_port 5173

require_command python3
require_command npm

# Create venv + install deps if missing
if [ ! -d "venv" ]; then
    echo "[SETUP] Creating virtual environment..."
    python3 -m venv venv
    echo "[SETUP] Installing Python dependencies..."
    venv/bin/pip install -r requirements.txt
fi

# Install frontend deps if node_modules missing
if [ ! -d "frontend/admin/node_modules" ]; then
    echo "[SETUP] Installing frontend dependencies..."
    cd frontend/admin && npm install && cd "$PROJECT_DIR"
fi

echo "[SETUP] Checking database connection..."
venv/bin/python - <<'PY'
from dotenv import dotenv_values
from urllib.parse import urlparse
import socket
import sys

database_url = dotenv_values(".env").get("SUPABASE_DATABASE_URL", "")

if not database_url:
    print("[ERROR] SUPABASE_DATABASE_URL is missing from .env")
    sys.exit(1)

parsed = urlparse(database_url)
host = parsed.hostname
port = parsed.port or 5432

if not host:
    print("[ERROR] SUPABASE_DATABASE_URL does not contain a database host")
    sys.exit(1)

print(f"[SETUP] Database host: {host}:{port}")

try:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
except socket.gaierror as error:
    print(f"[ERROR] Could not resolve database host: {error}")
    sys.exit(1)

families = {family for family, *_ in infos}

if socket.AF_INET6 in families and socket.AF_INET not in families:
    try:
        with open("/proc/net/ipv6_route", encoding="ascii") as routes:
            has_default_ipv6_route = any(
                line.startswith("0" * 32) and line.split()[8] != "lo"
                for line in routes
            )
    except OSError:
        has_default_ipv6_route = False

    if not has_default_ipv6_route:
        print("[ERROR] Database host resolves only to IPv6, but this machine has no IPv6 default route.")
        print("[ERROR] Use the Supabase session pooler URL in .env, or enable IPv6 networking.")
        sys.exit(1)

try:
    with socket.create_connection((host, port), timeout=5):
        pass
except OSError as error:
    print(f"[ERROR] Could not reach database host over TCP: {error}")
    sys.exit(1)

print("[SETUP] Database TCP check passed.")
PY

# Start Backend
echo "[1/2] Starting Flask Backend on http://127.0.0.1:5000..."
venv/bin/python app/services/database.py &
BACKEND_PID=$!

# Start Frontend
echo "[2/2] Starting Admin Frontend on http://localhost:5173..."
cd frontend/admin
npm run dev &
FRONTEND_PID=$!

# Wait for background processes
wait $BACKEND_PID $FRONTEND_PID
