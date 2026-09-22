@echo off
chcp 65001 >nul
title VisionChat - Native Windows

cd /d "%~dp0"

echo.
echo VisionChat native mode
echo Docker / WSL / Hyper-V are NOT required.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Start-VisionChat-Native.ps1"
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
  echo.
  echo Native launcher stopped with error %ERR%.
  pause
)

exit /b %ERR%
