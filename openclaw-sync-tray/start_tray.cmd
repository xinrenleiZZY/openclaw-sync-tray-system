@echo off
rem Start OpenClaw Usage Sync Tray as a hidden background process (no black / minimized cmd window).
rem No Windows Script Host dependency: uses powershell.exe -WindowStyle Hidden directly.
rem start "" spawns a detached process and cmd exits immediately, so no console window stays behind.
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0sync_tray.ps1" %*
exit /b
