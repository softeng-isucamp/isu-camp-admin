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


# ==========================================
# Stale Dev Server Reclaim
# ==========================================

# Vite runs with --strictPort, so a leftover dev server from an earlier run is
# a hard stop rather than a port bump. Both of the ports this script binds are
# therefore reclaimed first - but only from processes provably belonging to this
# checkout.

$PortOwners = @{ 5000 = "Flask backend"; 5173 = "Vite frontend" }

function Get-PortOwnerId {
    param([int]$Port)

    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($connection) { return [int]$connection.OwningProcess }

    # Hosts without the NetTCPIP module still have netstat.
    $line = netstat -ano 2>$null | Select-String ":$Port\s+.*LISTENING" | Select-Object -First 1
    if ($line) { return [int](($line.Line -split '\s+') | Where-Object { $_ } | Select-Object -Last 1) }

    return $null
}

function Get-ProjectDevProcess {
    # Identified by command line, never by a recorded pid: Windows reuses pids,
    # so a stored one can name an unrelated process by the time it is read.
    #
    # Seeds are python/node processes whose command line contains this checkout.
    # Their descendants are included too, because Flask's reloader runs the app
    # in a child launched with the system interpreter and a relative script
    # path - that child's own command line names neither this folder nor the
    # venv, yet it is the one holding the listening socket.
    $escapedRoot = [regex]::Escape($ProjectRoot)
    $candidates = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @("python.exe", "pythonw.exe", "node.exe") })

    $seeds = @($candidates | Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match $escapedRoot -and
        ($_.CommandLine -match "database\.py" -or $_.CommandLine -match "vite")
    })

    # A plain hashtable, not [ordered]@{}: an ordered dictionary treats an
    # integer index as a position rather than a key, so storing by pid throws.
    $selected = @{}
    $queue = [System.Collections.Queue]::new()
    foreach ($seed in $seeds) { $queue.Enqueue($seed) }

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if ($selected.ContainsKey([int]$current.ProcessId)) { continue }
        $selected[[int]$current.ProcessId] = $current
        foreach ($child in $candidates | Where-Object { $_.ParentProcessId -eq $current.ProcessId }) {
            $queue.Enqueue($child)
        }
    }

    return @($selected.Values)
}

function Stop-ProjectDevProcess {
    param([switch]$Quiet)

    $stopped = 0
    foreach ($process in Get-ProjectDevProcess) {
        if (-not $Quiet) {
            Write-Host "[PORTS] Stopping leftover pid $($process.ProcessId) ($($process.Name))" -ForegroundColor Yellow
        }
        # /T kills the tree. Stopping only the parent is what left a reloader
        # child alive holding port 5000 under a pid that no longer existed.
        taskkill /PID $process.ProcessId /T /F 2>$null | Out-Null
        $stopped++
    }
    if ($stopped -gt 0) { Start-Sleep -Milliseconds 1200 }
    return $stopped
}

function Reset-DevPorts {
    param([int[]]$Ports)

    $busy = @($Ports | Where-Object { Get-PortOwnerId -Port $_ })
    if ($busy.Count -eq 0) { return }

    Write-Host "[PORTS] In use: $($busy -join ', '). Clearing a previous run..." -ForegroundColor Yellow
    Stop-ProjectDevProcess | Out-Null

    foreach ($port in $Ports) {
        $owner = Get-PortOwnerId -Port $port
        if (-not $owner) { continue }

        # Anything still holding the port is not ours to stop, so say whose it
        # is rather than killing it.
        $name = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
        $label = if ($name) { "pid $owner ($name)" } else { "pid $owner, already exited but its socket is still held" }
        Write-Host "[ERROR] Port $port ($($PortOwners[$port])) is held by $label." -ForegroundColor Red
        Write-Host "[ERROR] That is not a dev server from this folder, so it was left running. Stop it and re-run." -ForegroundColor Red
        exit 1
    }

    Write-Host "[PORTS] Ports clear." -ForegroundColor Green
}

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
    # Only the frontend port: fixture mode never binds 5000, so a process there
    # is none of this script's business.
    Reset-DevPorts -Ports 5173
    Set-Location (Join-Path $ProjectRoot "frontend\admin")
    try {
        npm run dev -- --host localhost --port 5173 --strictPort
        $FixtureExitCode = $LASTEXITCODE
    } finally {
        Stop-ProjectDevProcess -Quiet | Out-Null
    }
    exit $FixtureExitCode
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

# After the database check, so a port conflict never tears down a working
# previous run that this one could not have replaced anyway.
Reset-DevPorts -Ports 5000, 5173

Write-Host "[1/2] Starting Flask Backend on http://127.0.0.1:5000..." -ForegroundColor Green
$BackendProcess = Start-Process -FilePath $VenvPython -ArgumentList "app\services\database.py" -WorkingDirectory $ProjectRoot -PassThru

Write-Host "[2/2] Starting Admin Frontend on http://localhost:5173..." -ForegroundColor Green
Set-Location (Join-Path $ProjectRoot "frontend\admin")

try {
    npm run dev -- --host localhost --port 5173 --strictPort
    $FrontendExitCode = $LASTEXITCODE
} finally {
    Write-Host "Stopping Flask Backend..." -ForegroundColor Yellow
    if ($BackendProcess) {
        # taskkill /T rather than Stop-Process: Flask's reloader runs the app in
        # a child process that inherits the listening socket, and stopping only
        # the parent left that child holding port 5000.
        taskkill /PID $BackendProcess.Id /T /F 2>$null | Out-Null
    }
    # A sweep as well, because the pid above is only a starting point: if the
    # parent has already gone, its children are no longer reachable through it.
    Stop-ProjectDevProcess -Quiet | Out-Null
}
exit $FrontendExitCode
