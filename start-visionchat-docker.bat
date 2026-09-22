@echo off
chcp 65001 >nul
title VisionChat - Docker

cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker not found.
  echo Install Docker Desktop and try again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js / npm not found.
  echo Install Node.js 20+ and try again.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
)

echo.
echo [1/3] Starting VisionChat backend...
docker compose up -d
if errorlevel 1 (
  echo [ERROR] Docker backend failed to start.
  pause
  exit /b 1
)

echo.
echo [2/3] Installing web dependencies...
if not exist "node_modules" (
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo [3/3] Starting VisionChat...
echo Web:     http://localhost:5173
echo Backend: http://localhost:6060
echo.
call npm run dev
