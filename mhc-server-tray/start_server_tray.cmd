@echo off
rem 模型健康监控中心 - 服务端快捷托盘启动器
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server_tray.ps1"
