# ISU-CAMP Development Server Runner
param([string]$Mode = "--real")
$ErrorActionPreference = "Stop"

if ($Mode -eq "--help" -or $Mode -eq "-h") {
    Write-Host "Usage: .\dev.ps1 [--real|--fixture] (default: --real)"
    exit 0
}
if ($Mode -notin @("--real", "--fixture") -or $args.Count -gt 0) {
    Write-Host "Usage: .\dev.ps1 [--real|--fixture]"
    exit 1
}

$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Starting ISU-CAMP Backend & Frontend " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Check for required commands
if ($Mode -eq "--real" -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Required command not found: python" -ForegroundColor Red
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Required command not found: npm" -ForegroundColor Red
    exit 1
}

# Create venv + install deps if missing
$VenvPython = Join-Path $ProjectRoot "venv\Scripts\python.exe"
if ($Mode -eq "--real" -and -not (Test-Path $VenvPython)) {
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

# Process environment overrides Vite's local .env file.
if ($Mode -eq "--fixture") {
    $env:VITE_TEST_LOCAL_ADAPTER = "true"
    $env:VITE_API_MODE = "local"
    $env:VITE_MAP_FIXTURE = "osm"
    Write-Host "[MODE] Fixture: local OSM demo data; Flask and database are not used."
    Write-Host "[LOGIN] Fixture only: admin_justine / password123"
    Set-Location (Join-Path $ProjectRoot "frontend\admin")
    npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
    exit $LASTEXITCODE
}

$env:VITE_TEST_LOCAL_ADAPTER = "false"
$env:VITE_API_MODE = "real"
$env:VITE_MAP_FIXTURE = "none"
if (-not $env:VITE_API_BASE_URL) { $env:VITE_API_BASE_URL = "http://127.0.0.1:5000" }
Write-Host "[MODE] Real: authenticated backend at $env:VITE_API_BASE_URL; database required."
Write-Host "[LOGIN] Use a real backend account. Fixture credentials do not apply."

Write-Host "[SETUP] Checking database connection..." -ForegroundColor Yellow
& $VenvPython (Join-Path $ProjectRoot "app\services\check_db.py")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Database preflight check failed." -ForegroundColor Red
    exit 1
}

Write-Host "[1/2] Starting Flask Backend on http://127.0.0.1:5000..." -ForegroundColor Green
$BackendProcess = Start-Process -FilePath $VenvPython -ArgumentList "app\services\database.py" -WorkingDirectory $ProjectRoot -PassThru

Write-Host "[2/2] Starting Admin Frontend on http://127.0.0.1:5173..." -ForegroundColor Green
Set-Location (Join-Path $ProjectRoot "frontend\admin")

try {
    npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
    $FrontendExitCode = $LASTEXITCODE
} finally {
    Write-Host "Stopping Flask Backend..." -ForegroundColor Yellow
    if ($BackendProcess -and -not $BackendProcess.HasExited) {
        Stop-Process -Id $BackendProcess.Id -Force
    }
}
exit $FrontendExitCode
