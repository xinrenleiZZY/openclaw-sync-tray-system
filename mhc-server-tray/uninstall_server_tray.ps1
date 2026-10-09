<#
卸载「模型健康监控中心 - 服务端快捷托盘」：
  - 停止正在运行的托盘实例
  - 移除开机自启动（HKCU Run）
  - 移除“设置-应用”卸载条目
  - 删除开始菜单/桌面快捷方式
  - 删除安装目录
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'MHCServerTray')
)

$ErrorActionPreference = 'Stop'

Write-Host '===== 模型健康监控中心 - 服务端托盘 卸载 =====' -ForegroundColor Cyan
Write-Host "安装目录: $InstallDir"

# 1. 停止正在运行的托盘实例
$escaped = [regex]::Escape((Join-Path $InstallDir 'server_tray.ps1'))
$procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -match $escaped -and
        $_.ProcessId -ne $PID
    }
foreach ($p in $procs) {
    Write-Host "停止托盘实例 (PID $($p.ProcessId))..." -ForegroundColor Yellow
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# 2. 移除开机自启动
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (Get-ItemProperty -Path $runKey -Name 'MHCServerTray' -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name 'MHCServerTray' -ErrorAction SilentlyContinue
    Write-Host '已移除开机自启动' -ForegroundColor Green
}

# 3. 移除“设置-应用”卸载条目
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MHCServerTray'
if (Test-Path $uninstallKey) {
    Remove-Item -Path $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '已移除“设置-应用”卸载条目' -ForegroundColor Green
}

# 4. 删除开始菜单/桌面快捷方式
$paths = @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    [Environment]::GetFolderPath('Desktop')
)
foreach ($folder in $paths) {
    if (-not $folder) { continue }
    $lnk = Join-Path $folder '模型健康监控中心 服务端托盘.lnk'
    if (Test-Path -LiteralPath $lnk) {
        Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
        Write-Host "已删除快捷方式: $lnk" -ForegroundColor Green
    }
}

# 5. 删除安装目录（保留 logs 提示）
if (Test-Path -LiteralPath $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "已删除安装目录: $InstallDir" -ForegroundColor Green
}

Write-Host ''
Write-Host '卸载完成。' -ForegroundColor Cyan
