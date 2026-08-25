# ISU-CAMP Development Server Runner
$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Starting ISU-CAMP Backend & Frontend " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Check for required commands
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Required command not found: python" -ForegroundColor Red
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Required command not found: npm" -ForegroundColor Red
    exit 1
}

# Free ports used by backend/frontend
function Free-Port([int]$Port) {
    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($connections) {
            foreach ($conn in $connections) {
                $procId = $conn.OwningProcess
                if ($procId -gt 0 -and $procId -ne $PID) {
                    Write-Host "[SETUP] Killing stale process on port $Port (PID: $procId)..." -ForegroundColor Yellow
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                }
            }
            Start-Sleep -Seconds 1
        }
    } catch {
        # Fallback or ignore if Get-NetTCPConnection lacks elevation
    }
}

Free-Port 5000
Free-Port 5173

# Create venv + install deps if missing
$VenvPython = Join-Path $ProjectRoot "venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    Write-Host "[SETUP] Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
    Write-Host "[SETUP] Installing Python dependencies..." -ForegroundColor Yellow
    & (Join-Path $ProjectRoot "venv\Scripts\pip.exe") install -r requirements.txt
}

# Install frontend deps if node_modules missing
$NodeModules = Join-Path $ProjectRoot "frontend\admin\node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Host "[SETUP] Installing frontend dependencies..." -ForegroundColor Yellow
    Set-Location (Join-Path $ProjectRoot "frontend\admin")
    npm install
    Set-Location $ProjectRoot
}

# Point the admin frontend at the generated OSM development fixture.
$env:VITE_API_MODE = "local"
$env:VITE_MAP_FIXTURE = "osm"

Write-Host "[SETUP] Checking database connection..." -ForegroundColor Yellow
& $VenvPython (Join-Path $ProjectRoot "app\services\check_db.py")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Database preflight check failed." -ForegroundColor Red
    exit 1
}

Write-Host "[1/2] Starting Flask Backend on http://127.0.0.1:5000..." -ForegroundColor Green
$BackendProcess = Start-Process -FilePath $VenvPython -ArgumentList "app\services\database.py" -WorkingDirectory $ProjectRoot -PassThru

Write-Host "[2/2] Starting Admin Frontend on http://localhost:5173..." -ForegroundColor Green
Set-Location (Join-Path $ProjectRoot "frontend\admin")

try {
    npm run dev
} finally {
    Write-Host "Stopping Flask Backend..." -ForegroundColor Yellow
    if ($BackendProcess -and -not $BackendProcess.HasExited) {
        Stop-Process -Id $BackendProcess.Id -Force
    }
}
