# ISU-CAMP Development Server Runner
$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Starting ISU-CAMP Backend & Frontend " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

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
