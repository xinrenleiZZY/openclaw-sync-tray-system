<#
安装「模型健康监控中心 - 服务端快捷托盘」：
  - 复制托盘程序到 %LOCALAPPDATA%\MHCServerTray（可 -InstallDir 指定）
  - 生成托盘图标与 config.json
  - 注册开机自启动（当前用户 HKCU Run）
  - 启动托盘（可 -NoStart 跳过）
服务端托盘的用途：在 Docker 宿主机上提供监控中心的快捷导航与一键同步全部托盘。
#>
[CmdletBinding()]
param(
    [string]$Server = $(if ($env:MHC_HOST) { "http://$($env:MHC_HOST):$($env:MHC_API_PORT)" } else { 'http://192.168.0.193:7601' }),
    [string]$WebUrl = $(if ($env:MHC_HOST) { "http://$($env:MHC_HOST):$($env:MHC_WEB_PORT)" } else { 'http://192.168.0.193:7600' }),
    [int]$PollSeconds = 30,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'MHCServerTray'),
    [switch]$Force,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$SourceDir = $PSScriptRoot

Write-Host '===== 模型健康监控中心 - 服务端快捷托盘 安装 =====' -ForegroundColor Cyan
Write-Host "安装目录: $InstallDir"
Write-Host "监控中心: $Server  网站: $WebUrl  刷新间隔: ${PollSeconds} 秒"

# 停止正在运行的旧托盘实例（避免双开 / 旧代码残留）
function Stop-RunningTray {
    param([string]$Dir)
    $escaped = [regex]::Escape((Join-Path $Dir 'server_tray.ps1'))
    $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -match $escaped -and
            $_.ProcessId -ne $PID
        }
    foreach ($p in $procs) {
        Write-Host "停止旧托盘实例 (PID $($p.ProcessId))..." -ForegroundColor Yellow
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    # 等待旧实例完全退出，释放单实例 mutex
    foreach ($p in $procs) {
        $deadline = (Get-Date).AddSeconds(8)
        while ((Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 200
        }
    }
}

# 0. 需要启动新实例前，先停止正在运行的旧托盘（保留 config.json，避免双开/旧代码残留）
if (-not $NoStart) {
    Stop-RunningTray -Dir $InstallDir
}

# 1. 创建目录并复制文件
New-Item -ItemType Directory -Path (Join-Path $InstallDir 'assets') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir 'logs') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $SourceDir 'server_tray.ps1') -Destination (Join-Path $InstallDir 'server_tray.ps1') -Force
Copy-Item -LiteralPath (Join-Path $SourceDir 'start_server_tray.cmd') -Destination (Join-Path $InstallDir 'start_server_tray.cmd') -Force

# 2. 生成托盘图标（32x32：深蓝圆底 + 白色监控折线 + 绿色数据点）
$IconPath = Join-Path $InstallDir 'assets\tray-icon.png'
$bmp = New-Object System.Drawing.Bitmap 32, 32
try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 41, 59))
    $g.FillEllipse($bgBrush, 1, 1, 30, 30)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, 2.5)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $p1 = New-Object System.Drawing.Point 7, 23
    $p2 = New-Object System.Drawing.Point 13, 17
    $p3 = New-Object System.Drawing.Point 18, 20
    $p4 = New-Object System.Drawing.Point 25, 10
    $g.DrawLines($pen, @($p1, $p2, $p3, $p4))
    $dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 52, 211, 153))
    $g.FillEllipse($dotBrush, 22.5, 7.5, 5, 5)

    # 先画入内存流再写文件，规避 GDI+ 直接保存到文件时偶发的“一般性错误”
    New-Item -ItemType Directory -Path (Join-Path $InstallDir 'assets') -Force | Out-Null
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    [System.IO.File]::WriteAllBytes($IconPath, $ms.ToArray())
    $ms.Dispose()

    # 导出 32x32 .ico，供开始菜单/桌面快捷方式与“设置-应用”列表图标使用
    $IcoPath = Join-Path $InstallDir 'assets\tray-icon.ico'
    $hicon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hicon)
    $fs = [System.IO.File]::Create($IcoPath)
    $icon.Save($fs)
    $fs.Dispose()
    try {
        # PowerShell 5.1 无 DestroyIcon 静态方法，隐藏释放句柄以保兼容
        [System.Runtime.InteropServices.Marshal]::DestroyIcon($hicon)
    } catch { }
    $icon.Dispose()
}
catch {
    Write-Host "错误：生成托盘图标失败：$($_.Exception.Message)（请检查安装目录是否可写）" -ForegroundColor Red
    exit 1
}
finally {
    if ($g) { $g.Dispose() }
    if ($bgBrush) { $bgBrush.Dispose() }
    if ($pen) { $pen.Dispose() }
    if ($dotBrush) { $dotBrush.Dispose() }
    $bmp.Dispose()
}

# 3. 生成 config.json（已存在且未 -Force 时保留）
$ConfigPath = Join-Path $InstallDir 'config.json'
if ((Test-Path -LiteralPath $ConfigPath) -and -not $Force) {
    Write-Host '检测到已有 config.json，保留原配置（如需重置请加 -Force）' -ForegroundColor Yellow
} else {
    $cfg = @{
        server       = $Server
        web_url      = $WebUrl
        poll_seconds = $PollSeconds
    } | ConvertTo-Json
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($ConfigPath, $cfg, $utf8)
    Write-Host "已生成配置: $ConfigPath"
}

# 4. 注册开机自启动（当前用户）
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$launch = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\server_tray.ps1`""
Set-ItemProperty -Path $runKey -Name 'MHCServerTray' -Value $launch
Write-Host '已注册开机自启动（当前用户）' -ForegroundColor Green

# 5. 启动托盘
if (-not $NoStart) {
    Start-Process powershell.exe -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$InstallDir\server_tray.ps1`""
    ) | Out-Null
    Write-Host '托盘已启动，请在系统托盘找到图标' -ForegroundColor Green
} else {
    Write-Host '已跳过启动（-NoStart）' -ForegroundColor Yellow
}

# 6. 创建“开始菜单/桌面”启动快捷方式（托盘退出后可双击启动）
$IcoPath = Join-Path $InstallDir 'assets\tray-icon.ico'
try {
    $wsh = New-Object -ComObject WScript.Shell
    $shortcutTarget = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $shortcutArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $InstallDir 'server_tray.ps1') + '"'
    $paths = @(
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
        [Environment]::GetFolderPath('Desktop')
    )
    foreach ($folder in $paths) {
        if (-not $folder -or -not (Test-Path -LiteralPath $folder)) { continue }
        $lnk = $wsh.CreateShortcut((Join-Path $folder '模型健康监控中心 服务端托盘.lnk'))
        $lnk.TargetPath = $shortcutTarget
        $lnk.Arguments  = $shortcutArgs
        $lnk.WorkingDirectory = $InstallDir
        if (Test-Path -LiteralPath $IcoPath) { $lnk.IconLocation = $IcoPath }
        $lnk.Description = '模型健康监控中心 - 服务端快捷托盘'
        $lnk.Save()
    }
    Write-Host '已在开始菜单/桌面创建“模型健康监控中心 服务端托盘”启动快捷方式' -ForegroundColor Green
} catch {
    Write-Host "创建快捷方式失败（不影响托盘运行）：$($_.Exception.Message)" -ForegroundColor Yellow
}

# 7. 写入“设置-应用”卸载条目（当前用户 HKCU，无需管理员）
try {
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MHCServerTray'
    if (-not (Test-Path $uninstallKey)) { New-Item -Path $uninstallKey -Force | Out-Null }
    Set-ItemProperty -Path $uninstallKey -Name 'DisplayName'     -Value '模型健康监控中心 服务端托盘'
    Set-ItemProperty -Path $uninstallKey -Name 'Publisher'       -Value '模型健康监控中心'
    Set-ItemProperty -Path $uninstallKey -Name 'DisplayIcon'     -Value (Join-Path $InstallDir 'assets\tray-icon.ico')
    Set-ItemProperty -Path $uninstallKey -Name 'InstallLocation' -Value $InstallDir
    Set-ItemProperty -Path $uninstallKey -Name 'UninstallString' -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall_server_tray.ps1`""
    Set-ItemProperty -Path $uninstallKey -Name 'NoModify'        -Value 1 -Type DWord
    Set-ItemProperty -Path $uninstallKey -Name 'NoRepair'        -Value 1 -Type DWord
    Write-Host '已注册到“设置-应用”，可在安装应用列表中查看/卸载' -ForegroundColor Green
} catch {
    Write-Host "注册卸载条目失败（不影响托盘运行）：$($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '安装完成。系统托盘菜单可：打开网站 / Token构成 / 异常机器列表 / 在线机器数量 / 同步全部托盘 / 个人中心 / 设置' -ForegroundColor Cyan
Write-Host "托盘图标不见/托盘退出时，双击启动: `"$InstallDir\start_server_tray.cmd`"" -ForegroundColor Yellow
Write-Host "如需卸载，运行: powershell -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall_server_tray.ps1`"" -ForegroundColor Gray
