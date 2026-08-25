@echo off
SETLOCAL EnableDelayedExpansion

echo ==========================================
echo  Starting ISU-CAMP Backend ^& Frontend
echo ==========================================

:: Change directory to project root
cd /d "%~dp0"

:: Check required commands
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Required command not found: python
    exit /b 1
)

where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Required command not found: npm
    exit /b 1
)

:: Free ports 5000 and 5173 if occupied
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5000 " ^| findstr "LISTENING"') do (
    echo [SETUP] Killing stale process on port 5000 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    echo [SETUP] Killing stale process on port 5173 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

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

:: Point the admin frontend at the generated OSM development fixture
set "VITE_API_MODE=local"
set "VITE_MAP_FIXTURE=osm"

:: Check database connection
echo [SETUP] Checking database connection...
venv\Scripts\python.exe app\services\check_db.py
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Database preflight check failed.
    exit /b %ERRORLEVEL%
)

:: Start Backend in a new command window
echo [1/2] Starting Flask Backend on http://127.0.0.1:5000...
start "ISU-CAMP Backend" cmd /k "venv\Scripts\python.exe app\services\database.py"

:: Start Frontend in current window
echo [2/2] Starting Admin Frontend on http://localhost:5173...
cd frontend\admin
npm run dev
