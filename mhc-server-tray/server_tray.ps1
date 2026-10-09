[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ===== 路径 =====
$BaseDir = $PSScriptRoot
$ConfigPath = Join-Path $BaseDir 'config.json'
$LogDir = Join-Path $BaseDir 'logs'
$AppLog = Join-Path $LogDir 'server-tray.log'
$IconPath = Join-Path $BaseDir 'assets\tray-icon.png'

# ===== 默认配置 =====
# 优先使用环境变量 MHC_HOST / MHC_API_PORT / MHC_WEB_PORT，未设置时回退默认地址
$envHost = $env:MHC_HOST
$envApiPort = if ($env:MHC_API_PORT) { $env:MHC_API_PORT } else { '7601' }
$envWebPort = if ($env:MHC_WEB_PORT) { $env:MHC_WEB_PORT } else { '7600' }
$script:Config = @{
    server       = if ($envHost) { "http://${envHost}:${envApiPort}" } else { 'http://192.168.0.193:7601' }
    web_url      = if ($envHost) { "http://${envHost}:${envWebPort}" } else { 'http://192.168.0.193:7600' }
    poll_seconds = 30
    balance_threshold = 100
}

# ===== 运行时状态 =====
$script:onlineCount = 0
$script:totalMachines = 0
$script:abnormalCount = 0
$script:apiOnline = $false              # 后台服务健康：API 是否在线
$script:trayOnlineCount = 0            # 在线托盘数（上报过版本/确认过同步的机器）
$script:dsTodayTokens = 0              # Deepseek 今日 token
$script:dsTotalTokens = 0              # Deepseek 累计 token
$script:lastStatsRefresh = $null
$script:lastStatsError = ''
$script:lastSyncResult = ''            # 后台服务在线状态文本
$script:syncRunning = $false
$script:balance = $null                # 最近一次拉取的账户余额快照 {total_balance,currency,is_available,...}

# ===== 配置读写 =====
function Read-Config {
    if (Test-Path -LiteralPath $ConfigPath) {
        try {
            # config.json 由 install.ps1 以 UTF-8 无 BOM 写入，必须显式 UTF-8 读取，
            # 否则 PowerShell 5.1 会按 GBK 解码导致乱码
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
# 用 AppendAllText 静态方法：打开即写即关，绝不遗留 FileStream，
# 从而避免偶发出现在终结器( Finalize )阶段的 UnauthorizedAccessException 拖垮整个托盘进程。
function Write-Log {
    param([string]$Message)
    try {
        $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
        [System.IO.File]::AppendAllText($AppLog, "$line`r`n", [System.Text.Encoding]::UTF8)
    } catch {
        try {
            # 日志路径异常时回退到临时目录，保证日志不丢且不会再触发终结器崩溃
            [System.IO.File]::AppendAllText(
                (Join-Path $env:TEMP 'mhc-server-tray.log'),
                "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message`r`n",
                [System.Text.Encoding]::UTF8
            )
        } catch {}
    }
}

# ===== 气泡 =====
function Show-Balloon {
    param([string]$Title, [string]$Text, [System.Windows.Forms.ToolTipIcon]$Icon = [System.Windows.Forms.ToolTipIcon]::Info)
    try {
        if ($Text.Length -gt 120) { $Text = $Text.Substring(0, 120) + '…' }
        $script:notify.ShowBalloonTip(3000, $Title, $Text, $Icon)
    } catch {}
}

function Update-NotifyText {
    try {
        $script:notify.Text = "模型健康监控中心 - 在线 $($script:onlineCount)/$($script:totalMachines) 异常 $($script:abnormalCount)"
        if ($script:notify.Text.Length -gt 63) {
            $script:notify.Text = $script:notify.Text.Substring(0, 63)
        }
    } catch {}
}

# ===== 实时数据刷新 =====
function Refresh-Stats {
    if ($script:lastStatsRefresh -and ((Get-Date) - $script:lastStatsRefresh).TotalSeconds -lt [int]$script:Config.poll_seconds) {
        return
    }
    $script:lastStatsRefresh = Get-Date
    $err = @()
    $anyOk = $false

    # 后台服务健康：API /api/usage/machines 可达即在线
    try {
        $m = Invoke-RestMethod -Uri "$($script:Config.server)/api/usage/machines" -TimeoutSec 6
        $script:totalMachines = [int]$m.total
        $script:onlineCount = @($m.machines | Where-Object { $_.online }).Count
        $script:apiOnline = $true
        $anyOk = $true
    } catch {
        $script:apiOnline = $false
        $err += '后台不可达'
    }

    try {
        $a = Invoke-RestMethod -Uri "$($script:Config.server)/api/usage/abnormal-machines" -TimeoutSec 6
        $script:abnormalCount = [int]$a.abnormal_count
        if ($a.abnormal_count) { $null = $a.abnormal_count }
    } catch {
        $err += '异常列表获取失败'
    }

    # 在线托盘数（上报过版本/确认过同步的机器）
    try {
        $s = Invoke-RestMethod -Uri "$($script:Config.server)/api/tray/sync/status" -TimeoutSec 6
        $script:trayOnlineCount = @($s.machines).Count
    } catch {
        $err += '托盘状态获取失败'
    }

    # Deepseek token 构成（与 /deepseek 同口径：tokens 累计 / today_tokens 今日）
    try {
        $d = Invoke-RestMethod -Uri "$($script:Config.server)/api/deepseek/overview" -TimeoutSec 6
        $script:dsTotalTokens = [double]$d.tokens
        $script:dsTodayTokens = [double]$d.today_tokens
    } catch {
        $err += 'token获取失败'
    }

    # 账户余额：拉取快照并做低余额提醒（每次刷新都弹，直到余额回升）
    try {
        $b = Invoke-RestMethod -Uri "$($script:Config.server)/api/deepseek/balance" -TimeoutSec 6
        if ($b -and $null -ne $b.total_balance) {
            $script:balance = $b
            $balNum = [double]$b.total_balance
            $cur = if ($b.currency) { $b.currency } else { 'CNY' }
            $threshold = [double]$script:Config.balance_threshold
            if ($b.is_available -ne $false -and $balNum -lt $threshold) {
                Write-Log "WARN 账户余额不足：¥$([math]::Round($balNum,2)) $cur（低于阈值 ¥$threshold）"
                Show-Balloon '账户余额不足' "当前余额 ¥$([math]::Round($balNum,2)) $cur，低于 ¥$threshold，请尽快充值" Warning
            } else {
                Write-Log "INFO 账户余额：¥$([math]::Round($balNum,2)) $cur"
            }
        } else {
            $script:balance = $null
        }
    } catch {
        $script:balance = $null
        Write-Log "WARN 获取账户余额失败: $_"
    }

    if ($err.Count -gt 0) {
        $script:lastStatsError = ($err -join '；')
    } else {
        $script:lastStatsError = ''
    }
    Update-NotifyText
}

function Format-Token {
    param([double]$Value)
    if ($null -eq $Value -or $Value -eq 0) { return '0' }
    if ($Value -ge 1000000) { return ('{0:N2}M' -f ($Value / 1000000)) }
    if ($Value -ge 1000) { return ('{0:N1}k' -f ($Value / 1000)) }
    return '{0:N0}' -f $Value
}

# ===== 同步全部托盘 =====
function Invoke-SyncAllTrays {
    if ($script:syncRunning) {
        Show-Balloon '同步中' '已有一批同步指令正在下发，请稍候' Warning
        return
    }
    if (-not $script:Config.server) {
        Show-Balloon '同步失败' '未配置服务器地址' Error
        return
    }
    $script:syncRunning = $true
    try {
        $r = Invoke-RestMethod -Uri "$($script:Config.server)/api/tray/sync/request" -Method Post -TimeoutSec 10
        if ($r.status -eq 'ok') {
            $script:lastSyncResult = "已下发(epoch=$($r.epoch))"
            Show-Balloon '同步全部托盘' "已下发同步指令(本轮 $($r.epoch))，在线托盘将在几秒内同步" Info
            Write-Log "INFO 同步全部托盘成功 epoch=$($r.epoch)"
        } else {
            $script:lastSyncResult = '下发失败'
            Show-Balloon '同步失败' '服务器未返回成功状态' Error
        }
    } catch {
        $script:lastSyncResult = '下发失败'
        Show-Balloon '同步失败' "服务器不可达：$($_.Exception.Message)" Error
        Write-Log "ERROR 同步全部托盘失败: $_"
    }
    $script:syncRunning = $false
}

# ===== 打开网页 =====
function Open-WebPage {
    param([string]$Path)
    $base = $script:Config.web_url
    if (-not $base) {
        Show-Balloon '无法打开' '未配置网站地址' Error
        return
    }
    if ($Path -and $Path -ne '/') {
        $base = $base.TrimEnd('/') + $Path
    }
    try {
        Start-Process $base
    } catch {
        Show-Balloon '无法打开' $_.Exception.Message Error
    }
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
                Write-Log "ERROR 菜单操作失败: $_"
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

    $statsError = $script:lastStatsError
    if ($statsError) {
        $statsError = "（$statsError） 无法获取，请确认服务端后台已启动"
    }
    $healthText = if ($script:apiOnline) { "服务在线" } else { "服务离线" }

    # ===== 实时状态（点击跳转对应页面） =====
    $null = Add-MenuItem -Items $menu.Items -Text "在线机器数量：$($script:onlineCount) / $($script:totalMachines) 台" -Action { Open-WebPage -Path '/machines' }
    $null = Add-MenuItem -Items $menu.Items -Text "异常机器列表：$($script:abnormalCount) 台" -Action { Open-WebPage -Path '/abnormal' }
    [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    # ===== 快捷导航 =====
    $null = Add-MenuItem -Items $menu.Items -Text '🌐 打开网站' -Action { Open-WebPage -Path '/' }
    $null = Add-MenuItem -Items $menu.Items -Text "🌀 Token 构成：今日 $(Format-Token $script:dsTodayTokens) / 累计 $(Format-Token $script:dsTotalTokens)" -Action { Open-WebPage -Path '/deepseek' }
    $balanceText = '💰 账户余额：获取失败'
    if ($script:balance -and $null -ne $script:balance.total_balance) {
        $balNum = [double]$script:balance.total_balance
        $cur = if ($script:balance.currency) { $script:balance.currency } else { 'CNY' }
        $balanceText = "💰 账户余额：¥$([math]::Round($balNum,2)) $cur"
    }
    $null = Add-MenuItem -Items $menu.Items -Text $balanceText -Action { Open-WebPage -Path '/deepseek' }
    $null = Add-MenuItem -Items $menu.Items -Text "🖥️ 在线机器数量：$($script:onlineCount) 台" -Action { Open-WebPage -Path '/machines' }
    $null = Add-MenuItem -Items $menu.Items -Text "🚨 异常机器列表：$($script:abnormalCount) 台" -Action { Open-WebPage -Path '/abnormal' }
    [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    # ===== 操作 =====
    $null = Add-MenuItem -Items $menu.Items -Text '🔄 同步全部托盘' -Action { Invoke-SyncAllTrays }
    [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    # ===== 个人中心 / 设置 =====
    $null = Add-MenuItem -Items $menu.Items -Text '👤 个人中心' -Action { Open-WebPage -Path '/developer' }
    $null = Add-MenuItem -Items $menu.Items -Text '⚙️ 设置' -Action { Open-WebPage -Path '/settings' }
    [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    # ===== 系统状态 =====
    $null = Add-MenuItem -Items $menu.Items -Text "系统状态：$healthText　在线托盘 $($script:trayOnlineCount) 台" -Enabled $false
    if ($statsError) {
        $null = Add-MenuItem -Items $menu.Items -Text $statsError -Enabled $false
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
$mutex = New-Object System.Threading.Mutex($false, "Local\MHCServerTray.$sid")
$acquired = $false
try {
    $acquired = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
    $acquired = $true
}
if (-not $acquired) {
    Write-Output '服务端托盘已在运行（单实例）'
    exit 0
}

$notify = $null
$iconBmp = $null
try {
    # ===== 初始化 =====
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    Read-Config

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
    $notify.Text = '模型健康监控中心'
    $notify.Visible = $true

    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $notify.ContextMenuStrip = $menu
    $script:notify = $notify

    # 首次启动先拉取一次实时数据
    Refresh-Stats

    # ===== 定时器：每 5 秒刷新状态并重建菜单 =====
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 5000
    $timer.add_Tick({
        try {
            Refresh-Stats
        } catch {
            Write-Log "ERROR 定时器异常: $_"
        }
    })
    $timer.Start()

    # ===== 菜单事件 =====
    $menu.add_Opening({ Rebuild-Menu })
    $notify.add_DoubleClick({ Open-WebPage -Path '/' })

    Write-Log "INFO 服务端托盘启动 服务器=$($script:Config.server) 网站=$($script:Config.web_url)"
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
