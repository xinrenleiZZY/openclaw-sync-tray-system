# OpenClaw 用量同步托盘工具

基于 `openclaw_usage_stats.py` 开发的 Windows 托盘常驻程序：

- 系统托盘图标，右键菜单操作
- **每 2 小时**自动推送一次模型用量到监控中心（间隔可在 config.json 调整）
- **开机自启动**（当前用户注册表，可菜单开关）
- 常驻内存占用小（PowerShell + WinForms 托盘，无 Python 常驻进程）
- 同步时临时调用 `python openclaw_usage_stats.py --push ...`，脚本逻辑升级即生效

## 安装（推荐）

把整个 `openclaw-sync-tray` 文件夹复制到目标电脑，然后：

```powershell
cd openclaw-sync-tray
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

可选参数：

```powershell
# 指定监控中心 / 机器标识 / 同步间隔 / Python 命令
.\install.ps1 -Server http://192.168.0.193:7601 -Machine vm-01 -IntervalHours 2 -Python python

# 覆盖已有配置
.\install.ps1 -Force

# 只安装不启动
.\install.ps1 -NoStart
```

安装后系统托盘出现图标，右下角气泡提示"用量同步成功"即代表已入库。

## 托盘菜单

| 菜单项 | 功能 |
|--------|------|
| 状态 / 明细 / 下次自动同步 | 只读状态显示 |
| 立即同步 | 马上推送一次 |
| 自动同步：已开启/已关闭 | 切换每 N 小时自动推送 |
| 开机自启动：已开启/已关闭 | 切换开机自启（注册表） |
| 打开监控中心 | 浏览器打开大屏/控制台 |
| 打开配置文件 | 用记事本编辑 config.json |
| 打开日志文件夹 | 查看 logs/sync.log |
| 退出托盘 | 退出（不影响开机自启，除非关闭） |

## 配置文件 config.json

```json
{
  "server": "http://192.168.0.193:7601",
  "machine": "auto",
  "interval_hours": 2,
  "python": "python",
  "script_path": "openclaw_usage_stats.py",
  "web_url": "http://192.168.0.193:7600",
  "auto_sync": true
}
```

- `machine`: `auto` 使用主机名，或填写唯一标识（如 vm-01）
- `python`: 目标机器上的 Python 命令；若不在 PATH，填完整路径
- `script_path`: 相对托盘目录或绝对路径
- 修改后右键菜单会自动生效（除 server/machine 外建议重启托盘）

## 手动安装（不开机自启）

```powershell
.\sync_tray.ps1
```

## 卸载

```powershell
# 移除自启 + 停止托盘（保留数据）
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\OpenClawSyncTray\uninstall.ps1"

# 连配置日志一起删除
...\uninstall.ps1 -RemoveData
```

## 运行要求

- Windows 10/11，PowerShell 5.1+（系统自带）
- 目标机器有 Python（能运行 `openclaw_usage_stats.py` 即可，无额外依赖）
- 目标机器与监控中心 `192.168.0.193:7601` 局域网互通

## 日志位置

`%LOCALAPPDATA%\OpenClawSyncTray\logs\sync.log`
