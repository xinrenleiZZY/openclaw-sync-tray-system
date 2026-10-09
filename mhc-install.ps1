<#
一键安装 OpenClaw 用量同步托盘（模型健康监控中心）
用法: powershell -NoProfile -ExecutionPolicy Bypass -File mhc-install.ps1 -Machine 你的机器名

自动完成:
  1) 下载部署包 mhc-tray.zip（监控中心 /api/source/download）
  2) 解压部署包
  3) 以指定机器名（改名）运行 install.ps1 完成复制与安装
  4) 清理临时文件
#>
[CmdletBinding()]
param(
    [string]$Server = '__MHC_SERVER__',
    [string]$Machine = 'auto'
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Write-Host ''
Write-Host '===== 模型健康监控中心 · 一键安装 =====' -ForegroundColor Cyan
Write-Host "监控中心: $Server"
Write-Host "机器名  : $Machine"

# 临时目录（唯一，避免残留）
$tmpRoot = Join-Path $env:TEMP ("mhc-install-" + [guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $tmpRoot 'mhc-tray.zip'
$extractDir = Join-Path $tmpRoot 'extract'
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

try {
    # 1. 下载部署包
    Write-Host ''
    Write-Host '[1/4] 下载部署包 ...' -ForegroundColor Yellow
    $dlUrl = "$Server/api/source/download?target=tray"
    try {
        Invoke-WebRequest -Uri $dlUrl -OutFile $zipPath -UseBasicParsing
    } catch {
        curl.exe -L -o $zipPath $dlUrl
    }
    if (-not (Test-Path -LiteralPath $zipPath)) { throw "下载失败: $dlUrl" }
    $sizeKb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB)
    Write-Host ("     已下载 ({0:N0} KB)" -f $sizeKb) -ForegroundColor Green

    # 2. 解压
    Write-Host '[2/4] 解压部署包 ...' -ForegroundColor Yellow
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    # 3. 定位 install.ps1 并安装（改名 = 传 -Machine）
    Write-Host '[3/4] 安装（复制程序 / 生成配置 / 注册自启，并以机器名命名）...' -ForegroundColor Yellow
    $installScript = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter 'install.ps1' |
        Where-Object { $_.DirectoryName -match 'openclaw-sync-tray' } |
        Select-Object -First 1
    if (-not $installScript) { throw '未在部署包中找到 openclaw-sync-tray/install.ps1' }

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript.FullName -Server $Server -Machine $Machine
    if ($LASTEXITCODE -ne 0) { throw "install.ps1 执行失败 (退出码 $LASTEXITCODE)" }

    # 4. 清理临时文件
    Write-Host '[4/4] 清理临时文件 ...' -ForegroundColor Yellow
}
finally {
    if (Test-Path -LiteralPath $tmpRoot) {
        Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host '一键安装完成。系统托盘应出现图标（每 2 小时自动推送用量）。' -ForegroundColor Green
Write-Host "托盘图标不见/托盘退出时，双击启动: %LOCALAPPDATA%\OpenClawSyncTray\start_tray.cmd" -ForegroundColor Gray
