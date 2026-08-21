@echo off
SETLOCAL EnableDelayedExpansion

echo ==========================================
echo  Starting ISU-CAMP Backend ^& Frontend
echo ==========================================

:: Change directory to project root
cd /d "%~dp0"

:: Check virtual environment
if not exist "venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment 'venv' not found in %CD%
    exit /b 1
)

:: Start Backend in a new command window
echo [1/2] Starting Flask Backend on http://127.0.0.1:5000...
start "ISU-CAMP Backend" cmd /k "venv\Scripts\python.exe app\services\database.py"

:: Start Frontend in current window
echo [2/2] Starting Admin Frontend on http://localhost:5173...
cd frontend\admin
npm run dev
