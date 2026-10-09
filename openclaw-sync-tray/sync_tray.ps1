[CmdletBinding()]
param(
    [switch]$SelfUpdate
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ===== 路径 =====
$BaseDir = $PSScriptRoot
$ConfigPath = Join-Path $BaseDir 'config.json'
$LogDir = Join-Path $BaseDir 'logs'
$SyncLog = Join-Path $LogDir 'sync.log'
$IconPath = Join-Path $BaseDir 'assets\tray-icon.png'

# ===== 默认配置 =====
# 优先使用环境变量 MHC_HOST / MHC_API_PORT / MHC_WEB_PORT，未设置时回退默认地址
$envHost = $env:MHC_HOST
$envApiPort = if ($env:MHC_API_PORT) { $env:MHC_API_PORT } else { '7601' }
$envWebPort = if ($env:MHC_WEB_PORT) { $env:MHC_WEB_PORT } else { '7600' }
$script:Config = @{
    server          = if ($envHost) { "http://${envHost}:${envApiPort}" } else { 'http://192.168.0.193:7601' }
    machine         = 'auto'
    interval_hours  = 2
    python          = 'python'
    script_path     = 'openclaw_usage_stats.py'
    web_url         = if ($envHost) { "http://${envHost}:${envWebPort}" } else { 'http://192.168.0.193:7600' }
    auto_sync       = $true
    auto_update     = $true
}

# ===== 运行时状态 =====
$script:syncProc = $null
$script:syncTmpOut = ''
$script:syncTmpErr = ''
$script:nextSyncTime = $null
$script:nextUpdateCheck = $null
$script:lastSyncTime = '从未'
$script:lastSyncResult = '尚未同步'
$script:lastSyncDetail = ''
$script:updateChecked = $false
$script:lastRemoteCheck = $null
$script:lastSyncedEpoch = 0

# ===== 配置读写 =====
function Read-Config {
    if (Test-Path -LiteralPath $ConfigPath) {
        try {
            # config.json 由 install.ps1 以 UTF-8 无 BOM 写入，必须显式 UTF-8 读取，
            # 否则 PowerShell 5.1 会按 GBK 解码导致中文机器名乱码
            $raw = (Get-Content -Raw -LiteralPath $ConfigPath -Encoding UTF8).TrimStart([char]0xFEFF)
            $saved = $raw | ConvertFrom-Json
            foreach ($prop in @($script:Config.Keys)) {
                if ($null -ne $saved.$prop) {
                    $script:Config[$prop] = $saved.$prop
                }
            }
        } catch {
            Write-Log "WARN 读取配置失败，使用默认配置: $_"
        }
    }
}

function Write-Config {
    try {
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText(
            $ConfigPath,
            ($script:Config | ConvertTo-Json),
            $utf8
        )
    } catch {
        Write-Log "WARN 保存配置失败: $_"
    }
}

# ===== 日志 =====
function Write-Log {
    param([string]$Message)
    try {
        $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
        Add-Content -Path $SyncLog -Value $line -Encoding UTF8
    } catch {}
}

# ===== 工具函数 =====
function Resolve-ScriptPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return (Join-Path $BaseDir $Path)
}

function Get-MachineName {
    if ($script:Config.machine -and $script:Config.machine -ne 'auto') {
        return $script:Config.machine
    }
    return $env:COMPUTERNAME
}

function Get-AutoStartEnabled {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    return $null -ne (Get-ItemProperty -Path $runKey -Name 'OpenClawSyncTray' -ErrorAction SilentlyContinue)
}

function Set-AutoStart {
    param([bool]$Enable)
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $launch = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BaseDir\sync_tray.ps1`""
    if ($Enable) {
        Set-ItemProperty -Path $runKey -Name 'OpenClawSyncTray' -Value $launch
    } else {
        Remove-ItemProperty -Path $runKey -Name 'OpenClawSyncTray' -ErrorAction SilentlyContinue
    }
}

function Show-Balloon {
    param([string]$Title, [string]$Text, [System.Windows.Forms.ToolTipIcon]$Icon = [System.Windows.Forms.ToolTipIcon]::Info)
    try {
        # 气泡文本限长，避免超长明细把气泡撑得很大
        if ($Text.Length -gt 120) { $Text = $Text.Substring(0, 120) + '…' }
        $script:notify.ShowBalloonTip(3000, $Title, $Text, $Icon)
    } catch {}
}

function Update-NotifyText {
    try {
        $script:notify.Text = "OpenClaw 用量同步 - $($script:lastSyncResult)"
        # Windows 托盘提示文本上限 63 字符
        if ($script:notify.Text.Length -gt 63) {
            $script:notify.Text = $script:notify.Text.Substring(0, 63)
        }
    } catch {}
}

# ===== 版本与自动更新 =====
function Get-LocalVersion {
    $vf = Join-Path $BaseDir 'version.txt'
    if (Test-Path -LiteralPath $vf) {
        $lines = (Get-Content -Raw -LiteralPath $vf -Encoding UTF8).Trim() -split "`r?`n"
        return ($lines[0].Trim())
    }
    return '0.0.0'
}

function Compare-Version {
    param([string]$Remote, [string]$Local)
    $r = @($Remote -split '\.' | ForEach-Object { [int]($_ -replace '\D', '0') })
    $l = @($Local -split '\.' | ForEach-Object { [int]($_ -replace '\D', '0') })
    for ($i = 0; $i -lt 3; $i++) {
        $rv = if ($r.Count -gt $i) { $r[$i] } else { 0 }
        $lv = if ($l.Count -gt $i) { $l[$i] } else { 0 }
        if ($rv -gt $lv) { return $true }
        if ($rv -lt $lv) { return $false }
    }
    return $false
}

function Test-UpdateAvailable {
    try {
        $v = Invoke-RestMethod -Uri "$($script:Config.server)/api/source/version" -TimeoutSec 10
        if ($v.version -and (Compare-Version "$($v.version)" (Get-LocalVersion))) {
            return "$($v.version)"
        }
    } catch {}
    return $null
}

function Start-SelfUpdate {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { Write-Config }
    Write-Log "INFO 启动自动更新流程"
    try {
        Start-Process 'powershell.exe' -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File","`"$BaseDir\sync_tray.ps1`"","-SelfUpdate" -WindowStyle Hidden | Out-Null
    } catch {
        Write-Log "ERROR 启动更新进程失败: $_"
        Show-Balloon '自动更新失败' '无法启动更新进程' Error
        return
    }
    # 先隐藏并完全退出当前实例，由更新子进程等待本进程退出后再启动新实例
    $script:notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
}

function Get-NextNightlyUpdateCheck {
    # 每晚 22:00 定时自动检测更新（避免与用量推送冲突，冲突时由 Reschedule-UpdateCheck 推迟）
    $now = Get-Date
    $target = Get-Date -Year $now.Year -Month $now.Month -Day $now.Day -Hour 22 -Minute 0 -Second 0
    if ($target -le $now) { $target = $target.AddDays(1) }
    return $target
}

function Reschedule-UpdateCheck {
    # 重排定时更新检测，避开用量推送：
    #   - 同步任务进行中 → 半小时后再试
    #   - 距下次同步不足 30 分钟 → 推迟到同步完成后 40-60 分钟
    #   - 其余情况 → 排到下一个 22:00
    if ($script:syncProc -and -not $script:syncProc.HasExited) {
        $script:nextUpdateCheck = (Get-Date).AddMinutes(30)
        Write-Log "INFO 更新检测重排：同步任务进行中，30 分钟后再试"
        return
    }
    $syncTime = $script:nextSyncTime
    if ($syncTime -and $syncTime -gt (Get-Date)) {
        $diffMin = ($syncTime - (Get-Date)).TotalMinutes
        if ($diffMin -le 30) {
            $delay = Get-Random -Minimum 40 -Maximum 60
            $script:nextUpdateCheck = $syncTime.AddMinutes($delay)
            Write-Log "INFO 更新检测重排：距下次同步 ${diffMin:N0} 分钟，推迟到同步后 $delay 分钟（$($script:nextUpdateCheck.ToString('yyyy-MM-dd HH:mm:ss'))）"
            return
        }
    }
    $script:nextUpdateCheck = Get-NextNightlyUpdateCheck
    Write-Log "INFO 更新检测重排：下次定时检测 $($script:nextUpdateCheck.ToString('yyyy-MM-dd HH:mm:ss'))"
}

# ===== 更新执行（-SelfUpdate 模式，独立子进程） =====
if ($SelfUpdate) {
    $ErrorActionPreference = 'Continue'
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    Read-Config

    # 1. 等待主托盘进程完全退出（最多 60 秒），避免图标残留/双实例
    $waited = 0
    $escaped = [regex]::Escape($BaseDir + '\sync_tray.ps1')
    while ($waited -lt 60) {
        $running = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -match $escaped -and
                $_.CommandLine -notmatch 'SelfUpdate' -and
                $_.ProcessId -ne $PID
            }
        if (-not $running) { break }
        Start-Sleep -Seconds 1
        $waited++
    }

    # 2. 下载部署包并解压
    $tmpZip = Join-Path $env:TEMP 'mhc-update.zip'
    $tmpDir = Join-Path $env:TEMP ("mhc-update-" + [guid]::NewGuid().ToString('N'))
    try {
        Invoke-WebRequest -Uri "$($script:Config.server)/api/source/download" -OutFile $tmpZip -TimeoutSec 120
        Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
        $payload = Join-Path $tmpDir '模型健康监控'
        $newTray = Join-Path $payload 'openclaw-sync-tray'
        if (-not (Test-Path -LiteralPath (Join-Path $newTray 'sync_tray.ps1'))) {
            throw '下载的部署包结构异常'
        }

        # 3. 替换程序文件（保留 config.json 与 logs）
        Copy-Item -LiteralPath (Join-Path $newTray 'sync_tray.ps1') -Destination (Join-Path $BaseDir 'sync_tray.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $newTray 'start_tray.cmd') -Destination (Join-Path $BaseDir 'start_tray.cmd') -Force
        Copy-Item -LiteralPath (Join-Path $newTray 'install.ps1') -Destination (Join-Path $BaseDir 'install.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $newTray 'uninstall.ps1') -Destination (Join-Path $BaseDir 'uninstall.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $newTray 'README.md') -Destination (Join-Path $BaseDir 'README.md') -Force
        if (Test-Path -LiteralPath (Join-Path $newTray 'assets')) {
            New-Item -ItemType Directory -Path (Join-Path $BaseDir 'assets') -Force | Out-Null
            Copy-Item -Path (Join-Path $newTray 'assets\*') -Destination (Join-Path $BaseDir 'assets') -Recurse -Force
        }
        foreach ($extra in @('openclaw_usage_stats.py', 'version.txt', '使用说明书.md', 'CHANGELOG.md')) {
            $src = Join-Path $payload $extra
            if (Test-Path -LiteralPath $src) {
                Copy-Item -LiteralPath $src -Destination (Join-Path $BaseDir $extra) -Force
            }
        }

        Write-Log "OK 更新完成，新版本 $(Get-LocalVersion)"
    } catch {
        try { Add-Content -Path $SyncLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ERROR 自动更新失败: $_" -Encoding UTF8 } catch {}
    } finally {
        try {
            if (Test-Path -LiteralPath $tmpZip) { Remove-Item -LiteralPath $tmpZip -Force }
            if (Test-Path -LiteralPath $tmpDir) { Remove-Item -LiteralPath $tmpDir -Recurse -Force }
        } catch {}
    }

    # 无论更新成功与否，都尝试重新启动托盘，避免“托盘退出后无进程”的困境。
    # 更新成功 → 启动新代码；更新失败 → 启动本地残留的旧代码，保证托盘可用。
    try {
        Start-Process 'powershell.exe' -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File","`"$BaseDir\sync_tray.ps1`"" -WindowStyle Hidden | Out-Null
        Write-Log "OK 托盘已重新启动"
    } catch {
        try { Write-Log "ERROR 重新启动托盘失败: $_" } catch {}
    }
    exit 0
}

# ===== 远端同步指令（网页一键同步） =====
function Check-RemoteSyncCommand {
    if (-not $script:Config.server) { return }
    # 限制轮询频率，避免频繁请求局域网接口（服务器离线时也不至于每 5 秒都发起请求）
    if ($script:lastRemoteCheck -and ((Get-Date) - $script:lastRemoteCheck).TotalSeconds -lt 10) { return }
    $script:lastRemoteCheck = Get-Date
    try {
        $machine = Get-MachineName
        $localVer = Get-LocalVersion
        $r = Invoke-RestMethod -Uri "$($script:Config.server)/api/tray/sync/poll?machine=$([uri]::EscapeDataString($machine))&version=$([uri]::EscapeDataString($localVer))" -TimeoutSec 4
        if ($r.trigger) {
            # 本地守卫：同一纪元只同步一次，避免服务器端 ack 未持久化导致重复触发
            $curEpoch = [int]$r.epoch
            if ($curEpoch -le $script:lastSyncedEpoch) {
                return
            }
            $script:lastSyncedEpoch = $curEpoch
            Write-Log "INFO 收到网页同步指令(epoch=$curEpoch)，触发同步"
            try {
                # 机器名走 query 参数（与 poll 一致，避免 JSON body 在 PS5.1 下编码不一致导致服务端识别失败）
                Invoke-RestMethod -Uri "$($script:Config.server)/api/tray/sync/ack?machine=$([uri]::EscapeDataString($machine))&epoch=$curEpoch" -Method Post -TimeoutSec 4 | Out-Null
            } catch {
                Write-Log "WARN 确认同步指令失败: $_"
            }
            Start-Sync
        }
    } catch {
        # 服务器不可达时静默跳过，不影响托盘本身
    }
}

# ===== 同步 =====
function Start-Sync {
    if ($script:syncProc -and -not $script:syncProc.HasExited) {
        Show-Balloon '同步中' '已有同步任务正在执行，请稍候' Warning
        return
    }

    $scriptPath = Resolve-ScriptPath $script:Config.script_path
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        $msg = "未找到用量脚本: $scriptPath"
        $script:lastSyncResult = "失败：脚本不存在"
        $script:lastSyncTime = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $script:lastSyncDetail = $msg
        Write-Log "ERROR $msg"
        Show-Balloon '同步失败' $msg Error
        return
    }

    $machine = Get-MachineName
    $argLine = "`"$scriptPath`" --push --server $($script:Config.server) --machine `"$machine`""

    Write-Log "START 机器=$machine 服务器=$($script:Config.server) 脚本=$scriptPath"
    Write-Log "CMD $($script:Config.python) $argLine"
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $script:Config.python
        $psi.Arguments = $argLine
        $psi.WorkingDirectory = $BaseDir
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $p = [System.Diagnostics.Process]::Start($psi)
        $script:syncProc = $p
        $script:lastSyncResult = '同步中...'
        $script:lastSyncDetail = "已启动，等待结果 (机器: $machine)"
        Update-NotifyText
    } catch {
        $msg = "启动 Python 失败: $_"
        $script:lastSyncResult = '启动失败'
        $script:lastSyncTime = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $script:lastSyncDetail = $msg
        Write-Log "ERROR $msg"
        Show-Balloon '同步失败' $msg Error
    }
}

function Complete-Sync {
    $out = ''
    $err = ''
    $code = $null
    try {
        $out = $script:syncProc.StandardOutput.ReadToEnd()
        $err = $script:syncProc.StandardError.ReadToEnd()
        $code = $script:syncProc.ExitCode
    } catch {}

    $script:lastSyncTime = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    if ($code -eq 0) {
        $summary = ($out -split "`n" | Where-Object { $_ -match '机器|条目|成本' }) -join ' | '
        $script:lastSyncResult = '成功'
        $script:lastSyncDetail = $summary
        Write-Log "OK 退出码=0 $summary"
        Show-Balloon '用量同步成功' "机器 $((Get-MachineName))：$summary" Info
    } else {
        $detail = ($err.Trim())
        if (-not $detail) { $detail = ($out -split "`n" | Select-Object -Last 3) -join ' ' }
        $script:lastSyncResult = "失败(退出码 $code)"
        $script:lastSyncDetail = $detail
        Write-Log "ERROR 退出码=$code $detail"
        Show-Balloon '用量同步失败' $detail Error
    }

    $script:syncProc = $null
    $script:nextSyncTime = (Get-Date).AddHours([double]$script:Config.interval_hours)
    Update-NotifyText
}

# ===== 托盘菜单 =====
function Add-MenuItem {
    param(
        [Parameter(Mandatory = $true)][object]$Items,
        [Parameter(Mandatory = $true)][string]$Text,
        [AllowNull()][scriptblock]$Action,
        [bool]$Enabled = $true
    )
    $item = New-Object System.Windows.Forms.ToolStripMenuItem $Text
    $item.Enabled = $Enabled
    if ($null -ne $Action) {
        $item.add_Click({
            try { & $Action } catch {
                $script:lastSyncDetail = $_.Exception.Message
                Show-Balloon '操作失败' $_.Exception.Message Error
            }
        }.GetNewClosure())
    }
    [void]$Items.Add($item)
    return $item
}

function Rebuild-Menu {
    if ($null -eq $menu) { return }
    try { $menu.Items.Clear() } catch { return }

    $autoSyncText = if ($script:Config.auto_sync) { "已开启（每 $($script:Config.interval_hours) 小时）" } else { '已关闭' }
    $autoStartText = if (Get-AutoStartEnabled) { '已开启' } else { '已关闭' }
    $next = if ($script:nextSyncTime) { $script:nextSyncTime.ToString('HH:mm') } else { '-' }

    # 明细行截断显示（最多 10 字符），完整内容放悬停提示，避免菜单被超长文本撑大
    $detailText = $script:lastSyncDetail
    if ($detailText.Length -gt 10) {
        $detailText = $detailText.Substring(0, 10) + '…'
    }

    $null = Add-MenuItem -Items $menu.Items -Text "状态：$($script:lastSyncResult)（$($script:lastSyncTime)）" -Enabled $false
    $detailItem = Add-MenuItem -Items $menu.Items -Text "明细：$detailText" -Enabled $false
    if ($detailItem) {
        $detailItem.ToolTipText = $script:lastSyncDetail
    }
    $null = Add-MenuItem -Items $menu.Items -Text "下次自动同步：$next" -Enabled $false
    $nextUpdate = if ($script:nextUpdateCheck) { $script:nextUpdateCheck.ToString('MM-dd HH:mm') } else { '已关闭' }
    $null = Add-MenuItem -Items $menu.Items -Text "下次自动更新检查：$nextUpdate" -Enabled $false
    $menu.ShowItemToolTips = $true
    [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    $null = Add-MenuItem -Items $menu.Items -Text '立即同步' -Action { Start-Sync }
    $null = Add-MenuItem -Items $menu.Items -Text "自动同步：$autoSyncText" -Action {
        $script:Config.auto_sync = -not $script:Config.auto_sync
        if ($script:Config.auto_sync) {
            $script:nextSyncTime = (Get-Date).AddHours([double]$script:Config.interval_hours)
        } else {
            $script:nextSyncTime = $null
        }
        Write-Config
    }
    $null = Add-MenuItem -Items $menu.Items -Text "自动更新：$(if ($script:Config.auto_update) { '已开启' } else { '已关闭' })" -Action {
        $script:Config.auto_update = -not $script:Config.auto_update
        Write-Config
        Write-Log "INFO 自动更新已$($(if ($script:Config.auto_update) {'开启'} else {'关闭'}))"
    }
    $null = Add-MenuItem -Items $menu.Items -Text "立即检查更新（当前 $(Get-LocalVersion)）" -Action {
        $remote = Test-UpdateAvailable
        if ($remote) {
            Show-Balloon '发现新版本' "服务器版本 $remote，开始自动更新..." Info
            Start-SelfUpdate
        } else {
            Show-Balloon '已是最新版本' "本地版本 $(Get-LocalVersion)" Info
        }
    }
    $null = Add-MenuItem -Items $menu.Items -Text "开机自启动：$autoStartText" -Action {
        $enable = -not (Get-AutoStartEnabled)
        Set-AutoStart -Enable $enable
        Write-Log "INFO 开机自启动已$($(if ($enable) {'开启'} else {'关闭'}))"
        Show-Balloon '开机自启动' $(if ($enable) { '已开启：开机自动运行同步托盘' } else { '已关闭' }) Info
    }
    [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    $null = Add-MenuItem -Items $menu.Items -Text '打开监控中心' -Action {
        Start-Process $script:Config.web_url
    }
    $null = Add-MenuItem -Items $menu.Items -Text '打开配置文件' -Action {
        if (-not (Test-Path -LiteralPath $ConfigPath)) { Write-Config }
        Start-Process notepad.exe -ArgumentList "`"$ConfigPath`""
    }
    $null = Add-MenuItem -Items $menu.Items -Text '打开日志文件夹' -Action {
        if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        Start-Process explorer.exe -ArgumentList $LogDir
    }
    [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    $null = Add-MenuItem -Items $menu.Items -Text '退出托盘' -Action {
        Write-Log 'INFO 用户退出托盘'
        $script:notify.Visible = $false
        [System.Windows.Forms.Application]::Exit()
    }
}

# ===== 单实例保护 =====
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex = New-Object System.Threading.Mutex($false, "Local\OpenClawSyncTray.$sid")
$acquired = $false
try {
    $acquired = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
    $acquired = $true
}
if (-not $acquired) {
    Write-Output '托盘已在运行（单实例）'
    exit 0
}

$notify = $null
$iconBmp = $null
try {
    # ===== 初始化 =====
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    Read-Config
    if (-not $script:Config.auto_sync) { $script:nextSyncTime = $null } else {
        $script:nextSyncTime = (Get-Date).AddHours([double]$script:Config.interval_hours)
    }
    if ($script:Config.auto_update) {
        $script:nextUpdateCheck = Get-NextNightlyUpdateCheck
        Write-Log "INFO 下次定时更新检测：$($script:nextUpdateCheck.ToString('yyyy-MM-dd HH:mm:ss'))"
    }

    $notify = New-Object System.Windows.Forms.NotifyIcon
    try {
        if (Test-Path -LiteralPath $IconPath) {
            $iconBmp = [System.Drawing.Image]::FromFile($IconPath)
            $notify.Icon = [System.Drawing.Icon]::FromHandle($iconBmp.GetHicon())
        }
    } catch {}
    if ($null -eq $notify.Icon) {
        $notify.Icon = [System.Drawing.SystemIcons]::Application
    }
    $notify.Text = 'OpenClaw 用量同步'
    $notify.Visible = $true

    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $notify.ContextMenuStrip = $menu
    $script:notify = $notify

    # ===== 定时器：每 5 秒检查同步结果 / 自动调度 =====
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 5000
    $timer.add_Tick({
        try {
            # 轮询远端同步指令（网页一键同步）
            Check-RemoteSyncCommand
            # 启动后首次 tick 自动检查更新（不阻塞托盘启动）
            if (-not $script:updateChecked) {
                $script:updateChecked = $true
                if ($script:Config.auto_update) {
                    $remote = Test-UpdateAvailable
                    if ($remote) {
                        Write-Log "INFO 发现新版本 $remote，开始自动更新"
                        Show-Balloon '发现新版本' "服务器版本 $remote，正在自动更新..." Info
                        Start-SelfUpdate
                        return
                    }
                }
            }
            # 每晚 22:00 定时检测更新（避开用量推送时段：同步进行中或距下次同步不足 30 分钟则推迟）
            if ($script:Config.auto_update -and $script:nextUpdateCheck -and (Get-Date) -ge $script:nextUpdateCheck) {
                if (($script:syncProc -and -not $script:syncProc.HasExited) -or
                    ($script:nextSyncTime -and $script:nextSyncTime -gt (Get-Date) -and ($script:nextSyncTime - (Get-Date)).TotalMinutes -le 30)) {
                    Reschedule-UpdateCheck
                } else {
                    $remote = Test-UpdateAvailable
                    if ($remote) {
                        Write-Log "INFO 定时检测发现新版本 $remote，开始自动更新"
                        Show-Balloon '发现新版本' "服务器版本 $remote，正在自动更新..." Info
                        Start-SelfUpdate
                        return
                    }
                    Reschedule-UpdateCheck
                }
            }
            if ($script:syncProc) {
                if ($script:syncProc.HasExited) {
                    Complete-Sync
                }
            } elseif ($script:nextSyncTime -and (Get-Date) -ge $script:nextSyncTime) {
                Start-Sync
            }
        } catch {
            Write-Log "ERROR 定时器异常: $_"
        }
    })
    $timer.Start()

    # ===== 菜单事件 =====
    $menu.add_Opening({ Rebuild-Menu })
    $notify.add_DoubleClick({ Start-Sync })
    Rebuild-Menu

    Write-Log "INFO 托盘启动 机器=$((Get-MachineName)) 服务器=$($script:Config.server) 自动同步=$($script:Config.auto_sync)"
    [System.Windows.Forms.Application]::Run()
} finally {
    try { if ($timer) { $timer.Stop(); $timer.Dispose() } } catch {}
    if ($notify) {
        try {
            if ($notify.Icon) { [System.Runtime.InteropServices.Marshal]::DestroyIcon($notify.Icon.Handle) }
        } catch {}
        try { $notify.Dispose() } catch {}
    }
    if ($iconBmp) { try { $iconBmp.Dispose() } catch {} }
    if ($acquired) { try { $mutex.ReleaseMutex() } catch {} }
    $mutex.Dispose()
}
