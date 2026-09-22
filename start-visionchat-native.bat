@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title VisionChat - Native Windows (No PowerShell scripts)

cd /d "%~dp0"

echo.
echo ============================================================
echo   VisionChat Native Windows
echo   Docker / WSL / Hyper-V / .ps1 scripts are NOT required
echo ============================================================
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js / npm not found.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

where curl.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] curl.exe not found.
  echo Windows 10/11 normally includes curl.
  pause
  exit /b 1
)

where tar.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] tar.exe not found.
  echo Windows 10/11 normally includes tar.
  pause
  exit /b 1
)

echo [1/5] Checking PostgreSQL...

set "PGREADY="
for /f "delims=" %%I in ('where pg_isready.exe 2^>nul') do (
  if not defined PGREADY set "PGREADY=%%I"
)

if not defined PGREADY (
  for /f "delims=" %%D in ('dir /b /ad /o-n "%ProgramFiles%\PostgreSQL" 2^>nul') do (
    if exist "%ProgramFiles%\PostgreSQL\%%D\bin\pg_isready.exe" (
      if not defined PGREADY set "PGREADY=%ProgramFiles%\PostgreSQL\%%D\bin\pg_isready.exe"
    )
  )
)

if not defined PGREADY (
  echo.
  echo [ERROR] PostgreSQL was not found.
  echo Install PostgreSQL 13 or newer for Windows.
  echo.
  echo Development settings expected by VisionChat:
  echo   User:     postgres
  echo   Password: postgres
  echo   Port:     5432
  echo.
  pause
  exit /b 2
)

"%PGREADY%" -h localhost -p 5432 >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] PostgreSQL is installed but is not responding on localhost:5432.
  echo Open services.msc and start the PostgreSQL service, then run this BAT again.
  echo.
  pause
  exit /b 3
)

echo       PostgreSQL OK.

set "NATIVE=%~dp0.native"
set "TINODEROOT=%NATIVE%\tinode"
set "TINODEZIP=%NATIVE%\tinode-postgres.windows-amd64.zip"
set "TINODEVER=v0.25.3"
set "TINODEURL=https://github.com/tinode/chat/releases/download/%TINODEVER%/tinode-postgres.windows-amd64.zip"

if not exist "%NATIVE%" mkdir "%NATIVE%" >nul 2>nul

echo [2/5] Preparing Tinode for Windows...

set "TINODEEXE="
for /r "%TINODEROOT%" %%F in (tinode.exe) do (
  if not defined TINODEEXE set "TINODEEXE=%%F"
)

if not defined TINODEEXE (
  echo       Downloading Tinode %TINODEVER%...
  curl.exe -L --fail --retry 3 -o "%TINODEZIP%" "%TINODEURL%"
  if errorlevel 1 (
    echo.
    echo [ERROR] Failed to download Tinode.
    pause
    exit /b 4
  )

  if exist "%TINODEROOT%" rmdir /s /q "%TINODEROOT%"
  mkdir "%TINODEROOT%" >nul 2>nul

  tar.exe -xf "%TINODEZIP%" -C "%TINODEROOT%"
  if errorlevel 1 (
    echo.
    echo [ERROR] Failed to extract Tinode.
    pause
    exit /b 5
  )

  for /r "%TINODEROOT%" %%F in (tinode.exe) do (
    if not defined TINODEEXE set "TINODEEXE=%%F"
  )
)

if not defined TINODEEXE (
  echo [ERROR] tinode.exe not found after extraction.
  pause
  exit /b 6
)

for %%D in ("%TINODEEXE%") do set "TINODEDIR=%%~dpD"

set "INITDB="
for /r "%TINODEROOT%" %%F in (init-db.exe) do (
  if not defined INITDB set "INITDB=%%F"
)

if not defined INITDB (
  echo [ERROR] init-db.exe not found.
  pause
  exit /b 7
)

echo [3/5] Checking Tinode database...

pushd "%TINODEDIR%"
"%INITDB%" --no_init >nul 2>nul
if errorlevel 1 (
  echo       Initializing database...
  if exist "%TINODEDIR%data.json" (
    "%INITDB%" -data="%TINODEDIR%data.json"
  ) else (
    "%INITDB%"
  )

  if errorlevel 1 (
    echo.
    echo [ERROR] Tinode database initialization failed.
    echo Most commonly PostgreSQL password is not "postgres".
    echo Expected development connection:
    echo   postgres / postgres @ localhost:5432
    echo.
    popd
    pause
    exit /b 8
  )
) else (
  echo       Tinode database already exists.
)
popd

echo [4/5] Starting Tinode...

curl.exe -s --max-time 1 http://localhost:6060/ >nul 2>nul
if errorlevel 1 (
  start "VisionChat Tinode" /D "%TINODEDIR%" "%TINODEEXE%"
)

set /a WAIT=0
:wait_tinode
curl.exe -s --max-time 1 http://localhost:6060/ >nul 2>nul
if not errorlevel 1 goto tinode_ready
set /a WAIT+=1
if !WAIT! GEQ 30 (
  echo.
  echo [ERROR] Tinode did not start on port 6060.
  echo Check the "VisionChat Tinode" window for the exact error.
  pause
  exit /b 9
)
timeout /t 1 /nobreak >nul
goto wait_tinode

:tinode_ready
echo       Tinode OK: http://localhost:6060

echo [5/5] Starting VisionChat web client...

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
)

if not exist "node_modules" (
  echo       Installing npm packages...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 10
  )
)

echo.
echo ============================================================
echo   VisionChat: http://localhost:5173
echo   Tinode:     http://localhost:6060
echo ============================================================
echo.

call npm.cmd run dev
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" pause
exit /b %ERR%
