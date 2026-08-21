@echo off
SETLOCAL EnableDelayedExpansion

echo ==========================================
echo  Starting ISU-CAMP Backend ^& Frontend
echo ==========================================

:: Change directory to project root
cd /d "%~dp0"

:: Create venv + install deps if missing
if not exist "venv\Scripts\python.exe" (
    echo [SETUP] Creating virtual environment...
    python -m venv venv
    echo [SETUP] Installing Python dependencies...
    venv\Scripts\pip install -r requirements.txt
)

:: Install frontend deps if node_modules missing
if not exist "frontend\admin\node_modules" (
    echo [SETUP] Installing frontend dependencies...
    cd frontend\admin && npm install && cd "%~dp0"
)

:: Start Backend in a new command window
echo [1/2] Starting Flask Backend on http://127.0.0.1:5000...
start "ISU-CAMP Backend" cmd /k "venv\Scripts\python.exe app\services\database.py"

:: Start Frontend in current window
echo [2/2] Starting Admin Frontend on http://localhost:5173...
cd frontend\admin
npm run dev
