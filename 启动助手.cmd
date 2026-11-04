@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if exist "%~dp0ihearit.exe" (
  start "" "%~dp0ihearit.exe"
  exit /b
)
if exist "%~dp0听个响.exe" (
  start "" "%~dp0听个响.exe"
  exit /b
)
if exist "%~dp0噪音助手.exe" (
  start "" "%~dp0噪音助手.exe"
  exit /b
)
start "" wscript.exe "%~dp0启动助手.vbs"
