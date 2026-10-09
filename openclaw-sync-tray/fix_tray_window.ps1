# fix_tray_window.ps1
# 让 OpenClaw 用量同步托盘 完全无窗口启动（不出现黑窗 / 最小化 cmd 窗口）。
# 在出现黑窗的虚拟机/采集电脑上运行本脚本即可。
# 它会把所有启动入口（自启 Run、start_tray.cmd、快捷方式）统一改为调用
# powershell.exe -WindowStyle Hidden 直接运行 sync_tray.ps1（不依赖 Windows Script Host），
# 然后重启托盘为无窗口模式。
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'OpenClawSyncTray')
)
[System.Threading.Thread]::CurrentThread.CurrentUICulture = 'zh-CN'
$ErrorActionPreference = 'Continue'

$scriptPath = Join-Path $InstallDir 'sync_tray.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) {
    Write-Host "NOT FOUND: $scriptPath" -ForegroundColor Yellow
    Write-Host "Pass the real install dir, e.g. -InstallDir 'C:\path\OpenClawSyncTray'" -ForegroundColor Yellow
    exit 1
}
Write-Host "Install dir: $InstallDir" -ForegroundColor Cyan

# 构造隐藏启动 PowerShell 的参数串（不依赖 wscript.exe / vbs，适配 WSH 被禁用的机器）
function Get-HiddenLaunchArg {
    param([string]$Path)
    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Path`""
}

# 1. start_tray.cmd -> 直接调用隐藏 PowerShell（start "" 分离进程，cmd 立即退出，无残留窗口）
$cmdContent = "@echo off`r`nrem Start OpenClaw Usage Sync Tray as a hidden background process (no black / minimized cmd window).`r`nrem No Windows Script Host dependency: uses powershell.exe -WindowStyle Hidden directly.`r`nrem start \"\" spawns a detached process and cmd exits immediately, so no console window stays behind.`r`nstart \"\" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%~dp0sync_tray.ps1\" %*`r`nexit /b`r`n"
$cmdPath = Join-Path $InstallDir 'start_tray.cmd'
try {
    [System.IO.File]::WriteAllText($cmdPath, $cmdContent, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[OK] start_tray.cmd rewritten (windowless)." -ForegroundColor Green
} catch { Write-Host "[ERR] start_tray.cmd: $_" -ForegroundColor Yellow }

# 2. HKCU Run autostart key -> 隐藏 PowerShell 直接运行
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runVal = "powershell.exe " + (Get-HiddenLaunchArg $scriptPath)
try {
    $cur = (Get-ItemProperty -Path $runKey -Name 'OpenClawSyncTray' -ErrorAction SilentlyContinue).OpenClawSyncTray
    $bad = ($cur -match 'Temp\\mhc-tray-update-test') -or ($cur -and ($cur -notmatch 'WindowStyle')) -or ($cur -and ($cur -match 'wscript'))
    if ($cur -ne $runVal -or $bad) {
        Set-ItemProperty -Path $runKey -Name 'OpenClawSyncTray' -Value $runVal
        Write-Host "[OK] Run key fixed (windowless hidden PowerShell)." -ForegroundColor Green
        Write-Host "       was: $cur" -ForegroundColor DarkGray
    } else {
        Write-Host "[OK] Run key already windowless." -ForegroundColor Green
    }
} catch { Write-Host "[ERR] Run key: $_" -ForegroundColor Yellow }

# 3. Shortcuts (Desktop + Start Menu Programs) -> powershell.exe -WindowStyle Hidden
$sh = New-Object -ComObject WScript.Shell
$folders = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('Programs'),
    [Environment]::GetFolderPath('CommonPrograms')
) | Where-Object { $_ }
foreach ($folder in $folders) {
    try {
        Get-ChildItem -Path $folder -Filter '*.lnk' -ErrorAction SilentlyContinue -Recurse -Depth 1 |
            Where-Object { $_.Name -like '*OpenClaw*' } |
            ForEach-Object {
                $lnk = $sh.CreateShortcut($_.FullName)
                $lnk.TargetPath = 'powershell.exe'
                $lnk.Arguments = Get-HiddenLaunchArg $scriptPath
                $lnk.WorkingDirectory = $InstallDir
                $lnk.WindowStyle = 7
                $lnk.Save()
                Write-Host "[OK] Shortcut fixed (windowless): $($_.Name)" -ForegroundColor Green
            }
    } catch { Write-Host "[ERR] shortcut folder $folder : $_" -ForegroundColor Yellow }
}

# 4. Kill any running tray instance (so the old visible one is gone), then restart windowless
$escaped = [regex]::Escape($scriptPath)
$running = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $escaped -and $_.CommandLine -notmatch 'SelfUpdate' }
foreach ($p in $running) {
    Write-Host "[OK] Stopping old tray instance pid=$($p.ProcessId)" -ForegroundColor DarkGray
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Seconds 1
try {
    Start-Process 'powershell.exe' -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File","`"$scriptPath`"" -WindowStyle Hidden | Out-Null
    Write-Host "[OK] Tray restarted windowless." -ForegroundColor Green
} catch { Write-Host "[ERR] restart tray: $_" -ForegroundColor Yellow }

Write-Host "`nDone. No black/minimized cmd window should appear now." -ForegroundColor Cyan
