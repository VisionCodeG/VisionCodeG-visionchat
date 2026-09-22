@echo off
chcp 65001 >nul
title VisionChat

cd /d "%~dp0"

echo.
echo VisionChat launcher
echo.
echo [1] Native Windows - no Docker / WSL / Hyper-V
echo [2] Docker
echo.

set /p "MODE=Choose mode [1]: "
if "%MODE%"=="" set "MODE=1"

if "%MODE%"=="2" (
  call "%~dp0start-visionchat-docker.bat"
  exit /b %ERRORLEVEL%
)

call "%~dp0start-visionchat-native.bat"
exit /b %ERRORLEVEL%
