@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0ihearit.exe" (
  start "" "%~dp0ihearit.exe"
  exit /b
)
start "" wscript.exe "%~dp0start.vbs"
