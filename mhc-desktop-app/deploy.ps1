# ModelHealthMonitor (Tauri) one-click build & deploy.
# Run this in a NORMAL PowerShell window (NOT the sandboxed agent terminal).
#   Right-click -> Run with PowerShell, or:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "e:\ZY2026\模型健康监控中心\mhc-desktop-app\deploy.ps1"

$ErrorActionPreference = 'Continue'

# ---------------------------------------------------------------------------
# 0. Environment prep
# ---------------------------------------------------------------------------
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if ($env:Path -notlike "*$cargoBin*") {
    $env:Path = "$cargoBin;$env:Path"
}

# Use rsproxy (CN) mirror for rustup downloads + cargo crates
$env:RUSTUP_DIST_SERVER = 'https://rsproxy.cn'
$env:RUSTUP_UPDATE_ROOT = 'https://rsproxy.cn/rustup'

# Make sure the cargo crates mirror config exists
$cfgDir = Join-Path $env:USERPROFILE '.cargo'
$cfgFile = Join-Path $cfgDir 'config.toml'
if (-not (Test-Path $cfgFile)) {
    New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
    @'
[source.crates-io]
replace-with = 'rsproxy'

[source.rsproxy]
registry = "sparse+https://rsproxy.cn/index/"

[registries.rsproxy]
index = "sparse+https://rsproxy.cn/index/"

[net]
retry = 3
'@ | Set-Content -LiteralPath $cfgFile -Encoding UTF8
    Write-Host 'Wrote cargo mirror config (rsproxy).' -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
# 1. Repair the Rust toolchain if rustc/cargo are broken
# ---------------------------------------------------------------------------
& rustc -V 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Rust toolchain is broken. Reinstalling stable ...' -ForegroundColor Yellow
    rustup uninstall stable 2>$null
    rustup default stable
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Could not install the Rust toolchain automatically.' -ForegroundColor Red
        Write-Host 'Run:  rustup default stable' -ForegroundColor Yellow
        exit 1
    }
}

# ---------------------------------------------------------------------------
# 1b. Load MSVC build tools environment (so cargo can find link.exe)
# ---------------------------------------------------------------------------
$vsWhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path $vsWhere) {
    $installPath = (& $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
    if ($installPath) {
        $vcvarsBat = Join-Path $installPath 'VC\Auxiliary\Build\vcvars64.bat'
        if (Test-Path $vcvarsBat) {
            Write-Host 'Configuring MSVC build environment ...' -ForegroundColor Cyan
            $envBlock = cmd /c "`"$vcvarsBat`" >nul 2>&1 && set"
            foreach ($line in $envBlock) {
                if ($line -match '^(.*?)=(.*)$') {
                    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].TrimEnd("`r"), 'Process')
                }
            }
        } else {
            Write-Host 'vcvars64.bat not found; if the build fails on link.exe, check Build Tools.' -ForegroundColor Yellow
        }
    } else {
        Write-Host 'MSVC (C++ Build Tools) not detected. Install them via VS Installer if build fails.' -ForegroundColor Yellow
    }
} else {
    Write-Host 'vswhere not found; MSVC environment was not configured.' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 2. Build release binary
# ---------------------------------------------------------------------------
$proj = Join-Path $PSScriptRoot 'src-tauri'
Set-Location $proj
Write-Host 'Compiling release ... first build downloads many crates and takes a while.' -ForegroundColor Cyan
cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Build failed. Scroll up for errors.' -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 3. Locate the produced exe
# ---------------------------------------------------------------------------
$binDir = Join-Path $proj 'target\release'
$exe = Join-Path $binDir 'mhc-desktop-app.exe'
if (-not (Test-Path $exe)) {
    Write-Host 'Release exe not found under target\release.' -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 4. Deploy to a stable app folder
# ---------------------------------------------------------------------------
$appDir = Join-Path $env:LOCALAPPDATA 'MHCDesktop'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
$target = Join-Path $appDir 'ModelHealthMonitor.exe'
Copy-Item -Force -LiteralPath $exe -Destination $target
# Copy any adjacent DLLs the app needs (e.g. WebView2Loader.dll)
Get-ChildItem -LiteralPath $binDir -Filter '*.dll' | ForEach-Object {
    Copy-Item -Force -LiteralPath $_.FullName -Destination (Join-Path $appDir $_.Name)
}

# ---------------------------------------------------------------------------
# 5. Create desktop + Start Menu shortcuts
# ---------------------------------------------------------------------------
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$progs = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
foreach ($dir in @($desktop, $progs)) {
    if (-not (Test-Path $dir)) { continue }
    $lnk = $ws.CreateShortcut((Join-Path $dir 'ModelHealthMonitor.lnk'))
    $lnk.TargetPath = $target
    $lnk.WorkingDirectory = $appDir
    $lnk.Description = 'MHC Monitor Center'
    $lnk.Save()
}

Write-Host ''
Write-Host 'Deployed successfully.' -ForegroundColor Green
Write-Host ('App exe  : ' + $target)
Write-Host 'Shortcuts: desktop + Start Menu (ModelHealthMonitor).'
Write-Host 'The app opens http://192.168.0.193:7600 and minimizes to tray.'
