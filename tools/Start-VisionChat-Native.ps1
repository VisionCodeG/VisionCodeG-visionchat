param(
    [switch]$SkipFrontend
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$NativeRoot = Join-Path $Root '.native'
$TinodeRoot = Join-Path $NativeRoot 'tinode'

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Find-PostgresBin {
    $pgReady = Get-Command pg_isready.exe -ErrorAction SilentlyContinue
    if ($pgReady) {
        return Split-Path -Parent $pgReady.Source
    }

    $base = Join-Path $env:ProgramFiles 'PostgreSQL'
    if (Test-Path $base) {
        $dirs = Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending

        foreach ($dir in $dirs) {
            $bin = Join-Path $dir.FullName 'bin'
            if (Test-Path (Join-Path $bin 'pg_isready.exe')) {
                return $bin
            }
        }
    }

    return $null
}

function Ensure-Postgres {
    Write-Step "Checking PostgreSQL"

    $pgBin = Find-PostgresBin
    if (-not $pgBin) {
        Write-Host "[ERROR] PostgreSQL was not found." -ForegroundColor Red
        Write-Host "Install PostgreSQL 13 or newer for Windows, then run this launcher again."
        Write-Host "For this development setup use:"
        Write-Host "  user: postgres"
        Write-Host "  password: postgres"
        throw "PostgreSQL is required for local Tinode without Docker."
    }

    $pgReady = Join-Path $pgBin 'pg_isready.exe'
    & $pgReady -h localhost -p 5432 | Out-Host

    if ($LASTEXITCODE -ne 0) {
        Write-Host "PostgreSQL is installed but not responding. Trying to start its Windows service..." -ForegroundColor Yellow

        $services = Get-Service -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -like 'postgresql*' -or $_.DisplayName -like 'PostgreSQL*'
        }

        foreach ($service in $services) {
            if ($service.Status -ne 'Running') {
                try {
                    Start-Service $service.Name -ErrorAction Stop
                } catch {
                    Write-Host "Could not start service $($service.Name): $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
        }

        Start-Sleep -Seconds 3
        & $pgReady -h localhost -p 5432 | Out-Host
    }

    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL is not running on localhost:5432."
    }

    return $pgBin
}

function Ensure-Tinode {
    Write-Step "Preparing native Tinode server"

    New-Item -ItemType Directory -Force -Path $NativeRoot | Out-Null

    $existing = Get-ChildItem $TinodeRoot -Filter tinode.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing) {
        Write-Host "Tinode already downloaded: $($existing.FullName)"
        return $existing
    }

    $headers = @{ 'User-Agent' = 'VisionChat-Native-Launcher' }
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/tinode/chat/releases/latest' -Headers $headers
    $asset = $release.assets | Where-Object { $_.name -eq 'tinode-postgres.windows-amd64.zip' } | Select-Object -First 1

    if (-not $asset) {
        throw "Could not find the Windows PostgreSQL Tinode release asset."
    }

    $zip = Join-Path $NativeRoot $asset.name
    Write-Host "Downloading Tinode $($release.tag_name)..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -Headers $headers

    if (Test-Path $TinodeRoot) {
        Remove-Item $TinodeRoot -Recurse -Force
    }

    New-Item -ItemType Directory -Force -Path $TinodeRoot | Out-Null
    Expand-Archive -Path $zip -DestinationPath $TinodeRoot -Force

    $exe = Get-ChildItem $TinodeRoot -Filter tinode.exe -Recurse | Select-Object -First 1
    if (-not $exe) {
        throw "tinode.exe was not found after extracting the release."
    }

    return $exe
}

function Ensure-TinodeDatabase([System.IO.FileInfo]$TinodeExe) {
    Write-Step "Checking Tinode database"

    $dir = $TinodeExe.Directory.FullName
    $init = Get-ChildItem $TinodeRoot -Filter init-db.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

    if (-not $init) {
        throw "init-db.exe was not found in the Tinode package."
    }

    Push-Location $init.Directory.FullName
    try {
        & $init.FullName --no_init
        $exists = ($LASTEXITCODE -eq 0)

        if ($exists) {
            Write-Host "Tinode database already exists."
            return
        }

        Write-Host "Tinode database is missing. Initializing it now..."
        $data = Get-ChildItem $init.Directory.FullName -Filter data.json -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

        if ($data) {
            & $init.FullName "-data=$($data.FullName)"
        } else {
            & $init.FullName
        }

        if ($LASTEXITCODE -ne 0) {
            throw "Tinode database initialization failed. Check PostgreSQL login/password. Native dev defaults are postgres/postgres."
        }
    } finally {
        Pop-Location
    }
}

function Start-Tinode([System.IO.FileInfo]$TinodeExe) {
    Write-Step "Starting Tinode on http://localhost:6060"

    $already = Get-NetTCPConnection -LocalPort 6060 -State Listen -ErrorAction SilentlyContinue
    if ($already) {
        Write-Host "Port 6060 is already listening; Tinode may already be running."
        return
    }

    Start-Process -FilePath $TinodeExe.FullName -WorkingDirectory $TinodeExe.Directory.FullName -WindowStyle Normal

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-WebRequest -Uri 'http://localhost:6060/' -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "Tinode is online." -ForegroundColor Green
                return
            }
        } catch {
        }
    }

    throw "Tinode did not become available on port 6060."
}

function Start-Frontend {
    if ($SkipFrontend) {
        return
    }

    Write-Step "Starting VisionChat web client"

    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw "Node.js/npm was not found. Install Node.js 20+."
    }

    Push-Location $Root
    try {
        if (-not (Test-Path (Join-Path $Root '.env'))) {
            Copy-Item (Join-Path $Root '.env.example') (Join-Path $Root '.env')
        }

        if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
            & npm.cmd install
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed."
            }
        }

        Write-Host ""
        Write-Host "VisionChat Web: http://localhost:5173" -ForegroundColor Green
        Write-Host "Tinode:         http://localhost:6060" -ForegroundColor Green
        Write-Host ""
        & npm.cmd run dev
    } finally {
        Pop-Location
    }
}

try {
    Ensure-Postgres | Out-Null
    $tinode = Ensure-Tinode
    Ensure-TinodeDatabase $tinode
    Start-Tinode $tinode
    Start-Frontend
} catch {
    Write-Host ""
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Docker is NOT required for this launcher."
    exit 1
}
