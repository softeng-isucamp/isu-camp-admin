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

# Cleanup handler on SIGINT (CTRL+C) or SIGTERM
cleanup() {
    echo ""
    echo "Shutting down servers..."
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
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
    cd frontend/admin
    exec npm run dev -- --host localhost --port 5173 --strictPort
fi

export VITE_TEST_LOCAL_ADAPTER=false
export VITE_API_MODE=real
export VITE_MAP_FIXTURE=none
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:5000}"
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

# Start Backend
echo "[1/2] Starting Flask Backend on http://127.0.0.1:5000..."
venv/bin/python app/services/database.py &
BACKEND_PID=$!

# Start Frontend
echo "[2/2] Starting Admin Frontend on http://localhost:5173..."
cd frontend/admin
npm run dev -- --host localhost --port 5173 --strictPort
