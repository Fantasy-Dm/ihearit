@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\bootstrap.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. Check the message above. Your data has not been removed.
  pause
  exit /b 1
)
