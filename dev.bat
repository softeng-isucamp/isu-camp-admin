@echo off
SETLOCAL

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
call :free_port 5000
call :free_port 5173

:: Create venv + install deps if missing
if not exist "venv\Scripts\python.exe" (
    echo [SETUP] Creating virtual environment...
    python -m venv venv
    echo [SETUP] Installing Python dependencies...
    venv\Scripts\pip install -r requirements.txt
)

:: Install frontend deps if node_modules missing
:: (npm is a .cmd script, so it must be invoked with "call" or this script stops)
if not exist "frontend\admin\node_modules" (
    echo [SETUP] Installing frontend dependencies...
    pushd frontend\admin
    call npm install
    popd
)

:: Point the admin frontend at the generated OSM development fixture
set "VITE_API_MODE=local"
set "VITE_MAP_FIXTURE=osm"

:: Start Backend in the background of this same window
echo [1/2] Starting Flask Backend on http://127.0.0.1:5000...
start "" /b "venv\Scripts\python.exe" app\services\database.py

:: Start Frontend in the foreground (CTRL+C stops both)
echo [2/2] Starting Admin Frontend on http://localhost:5173...
pushd frontend\admin
call npm run dev
popd

:: Frontend exited - make sure the backend doesn't keep running
echo Stopping Flask Backend...
call :free_port 5000
exit /b 0

:free_port
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%~1 " ^| findstr "LISTENING"') do (
    echo [SETUP] Killing process on port %~1 ^(PID: %%a^)...
    taskkill /F /PID %%a >nul 2>&1
)
exit /b 0
