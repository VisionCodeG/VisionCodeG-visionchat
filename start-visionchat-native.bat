@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title VisionChat - Native Windows (No Docker)

cd /d "%~dp0"

echo.
echo ============================================================
echo   VisionChat Native Windows
echo   Docker / WSL / Hyper-V / .ps1 scripts are NOT required
echo ============================================================
echo.

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

where curl.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] curl.exe not found.
  pause
  exit /b 1
)

where tar.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] tar.exe not found.
  pause
  exit /b 1
)

set "NATIVE=%~dp0.native"
set "TINODEROOT=%NATIVE%\tinode"
set "TINODEZIP=%NATIVE%\tinode-postgres.windows-amd64.zip"
set "PGPASSFILE=%NATIVE%\postgres-password.txt"
set "PATHSFILE=%TINODEROOT%\visionchat-native-paths.txt"
set "TINODEVER=v0.25.3"
set "TINODEURL=https://github.com/tinode/chat/releases/download/%TINODEVER%/tinode-postgres.windows-amd64.zip"

if not exist "%NATIVE%" mkdir "%NATIVE%" >nul 2>nul

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
  pause
  exit /b 2
)

"%PGREADY%" -h localhost -p 5432 >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] PostgreSQL is installed but is not responding on localhost:5432.
  echo Open services.msc and start the PostgreSQL service.
  pause
  exit /b 3
)

echo       PostgreSQL OK.

set "PGPASSWORD="
if exist "%PGPASSFILE%" (
  set /p PGPASSWORD=<"%PGPASSFILE%"
)

if not defined PGPASSWORD (
  echo.
  echo Enter the password you selected for PostgreSQL user "postgres".
  set /p "PGPASSWORD=PostgreSQL password: "
  if not defined PGPASSWORD set "PGPASSWORD=postgres"
  >"%PGPASSFILE%" echo(!PGPASSWORD!
  echo       Password saved locally in .native\postgres-password.txt
)

echo [2/5] Preparing Tinode for Windows...

if not exist "%TINODEROOT%" (
  mkdir "%TINODEROOT%" >nul 2>nul
)

set "TINODEEXE="

if exist "%TINODEROOT%\tinode.exe" (
  set "TINODEEXE=%TINODEROOT%\tinode.exe"
) else (
  for /f "delims=" %%F in ('dir /s /b "%TINODEROOT%\tinode.exe" 2^>nul') do (
    if not defined TINODEEXE set "TINODEEXE=%%F"
  )
)

if not defined TINODEEXE (
  echo       Tinode executable not found locally.
  echo       Downloading Tinode %TINODEVER%...

  if exist "%TINODEZIP%" del /f /q "%TINODEZIP%" >nul 2>nul

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

  if exist "%TINODEROOT%\tinode.exe" (
    set "TINODEEXE=%TINODEROOT%\tinode.exe"
  ) else (
    for /f "delims=" %%F in ('dir /s /b "%TINODEROOT%\tinode.exe" 2^>nul') do (
      if not defined TINODEEXE set "TINODEEXE=%%F"
    )
  )
)

if not exist "%TINODEROOT%" (
  echo [ERROR] Tinode directory was not created:
  echo   %TINODEROOT%
  pause
  exit /b 6
)

if not defined TINODEEXE (
  echo [ERROR] tinode.exe not found after extraction.
  pause
  exit /b 6
)

set "INITDB="
if exist "%TINODEROOT%\init-db.exe" (
  set "INITDB=%TINODEROOT%\init-db.exe"
) else (
  for /f "delims=" %%F in ('dir /s /b "%TINODEROOT%\init-db.exe" 2^>nul') do (
    if not defined INITDB set "INITDB=%%F"
  )
)

if not defined INITDB (
  echo [ERROR] init-db.exe not found.
  pause
  exit /b 7
)

for %%D in ("%TINODEEXE%") do set "TINODEDIR=%%~dpD"
for %%D in ("%INITDB%") do set "INITDIR=%%~dpD"

echo       Tinode root: %TINODEROOT%
echo       Tinode exe:  !TINODEEXE!
echo       Init DB exe: !INITDB!
echo       Applying PostgreSQL settings...
node.exe "%~dp0tools\Configure-Tinode-Postgres.mjs" "%TINODEROOT%" "!PGPASSWORD!"
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to configure Tinode for PostgreSQL.
  pause
  exit /b 8
)

set "DB_CONFIG="
set "SERVER_CONFIG="
if exist "%PATHSFILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%PATHSFILE%") do (
    if /i "%%A"=="DB_CONFIG" set "DB_CONFIG=%%B"
    if /i "%%A"=="SERVER_CONFIG" set "SERVER_CONFIG=%%B"
  )
)

if not defined DB_CONFIG (
  echo [ERROR] Tinode database config was not detected.
  pause
  exit /b 8
)

if not defined SERVER_CONFIG (
  echo [ERROR] Tinode server config was not detected.
  pause
  exit /b 8
)

echo       DB config: !DB_CONFIG!
echo       Server config: !SERVER_CONFIG!

echo [3/5] Checking Tinode database...

set "DATAFILE="
for /r "%TINODEROOT%" %%F in (data.json) do (
  if not defined DATAFILE set "DATAFILE=%%F"
)

pushd "%INITDIR%"
"%INITDB%" -config="!DB_CONFIG!" --no_init >nul 2>nul
if errorlevel 1 (
  echo       Database is missing or not initialized. Initializing...

  if defined DATAFILE (
    "%INITDB%" -config="!DB_CONFIG!" -data="!DATAFILE!"
  ) else (
    "%INITDB%" -config="!DB_CONFIG!"
  )

  if errorlevel 1 (
    echo.
    echo [ERROR] Tinode database initialization failed.
    echo.
    echo PostgreSQL connection used:
    echo   Host: localhost
    echo   Port: 5432
    echo   User: postgres
    echo   Password: the value saved in .native\postgres-password.txt
    echo.
    echo If the password is wrong:
    echo   1. Delete .native\postgres-password.txt
    echo   2. Run this BAT again
    echo   3. Enter the correct PostgreSQL password
    echo.
    popd
    pause
    exit /b 9
  )
) else (
  echo       Tinode database already exists.
)
popd

echo [4/5] Starting Tinode...

curl.exe -s --max-time 1 http://localhost:6060/ >nul 2>nul
if errorlevel 1 (
  start "VisionChat Tinode" /D "%TINODEDIR%" "%TINODEEXE%" -config="!SERVER_CONFIG!"
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
  exit /b 10
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
    exit /b 11
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
