<#
卸载 OpenClaw 用量同步托盘：
  - 移除开机自启动注册表项
  - 停止正在运行的托盘进程
  - -RemoveData 时删除安装目录（含配置与日志）
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'OpenClawSyncTray'),
    [switch]$RemoveData
)

$ErrorActionPreference = 'Continue'
Write-Host '===== OpenClaw 用量同步托盘 - 卸载 =====' -ForegroundColor Cyan

# 1. 移除自启动注册表
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Remove-ItemProperty -Path $runKey -Name 'OpenClawSyncTray' -ErrorAction SilentlyContinue
Write-Host '已移除开机自启动注册表项'

# 1b. 移除开始菜单/桌面快捷方式
try {
    $wsh = New-Object -ComObject WScript.Shell
    $paths = @(
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
        [Environment]::GetFolderPath('Desktop')
    )
    foreach ($folder in $paths) {
        if (-not $folder) { continue }
        $lnkPath = Join-Path $folder 'OpenClaw 用量同步托盘.lnk'
        if (Test-Path -LiteralPath $lnkPath) {
            Remove-Item -LiteralPath $lnkPath -Force -ErrorAction SilentlyContinue
            Write-Host "已删除快捷方式: $lnkPath"
        }
    }
} catch { Write-Host "清理快捷方式跳过: $($_.Exception.Message)" -ForegroundColor Yellow }

# 1c. 移除“设置-应用”卸载条目
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClawSyncTray'
if (Test-Path $uninstallKey) {
    Remove-Item -Path $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '已从“设置-应用”移除卸载条目'
}

# 2. 停止托盘进程（排除当前卸载进程）
try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object {
            $_.CommandLine -match 'sync_tray\.ps1' -and
            $_.CommandLine -notmatch 'uninstall\.ps1' -and
            $_.ProcessId -ne $PID
        }
    foreach ($proc in $procs) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "已停止托盘进程 PID=$($proc.ProcessId)"
    }
    if (-not $procs) {
        Write-Host '未发现运行中的托盘进程（可右键托盘图标退出）'
    }
} catch {
    Write-Host "停止托盘进程失败: $_" -ForegroundColor Yellow
}

# 3. 可选删除数据
if ($RemoveData) {
    if (Test-Path -LiteralPath $InstallDir) {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
        Write-Host "已删除安装目录: $InstallDir"
    }
} else {
    Write-Host "保留安装目录: $InstallDir（如需彻底删除加 -RemoveData）"
}

Write-Host '卸载完成' -ForegroundColor Green
