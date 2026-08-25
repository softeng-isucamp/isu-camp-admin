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

# Point the admin frontend at the generated OSM development fixture.
# Process-env variables override frontend/admin/.env in Vite.
export VITE_API_MODE=local
export VITE_MAP_FIXTURE=osm

echo "[SETUP] Checking database connection..."
venv/bin/python app/services/check_db.py

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
