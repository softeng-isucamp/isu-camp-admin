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

# Check Python venv
if [ ! -d "venv" ]; then
    echo "[ERROR] Virtual environment 'venv' not found in $PROJECT_DIR"
    exit 1
fi

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
