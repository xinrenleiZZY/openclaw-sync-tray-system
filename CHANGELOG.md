# 更新日志

## V1.0.14（2026-09-03）

### 修复

- 修复一键安装脚本 `install.ps1` 丢失 UTF-8 BOM 导致 Windows PowerShell 5.1 解析报 `Missing closing '}' in statement block`、安装中断；源文件补回 BOM，并在源码分发接口打包 `.ps1` 时统一补 BOM（含 GBK 容错解码），避免再次复发
- 修复部署包内 `mhc-install.ps1` 保留 `__MHC_SERVER__` 占位符：现按下载来源注入实际监控中心地址（保留 UTF-8 BOM）
- 修复同步崩溃 `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xb5`：会话 .jsonl 轨迹文件可能为 GBK 等非 UTF-8 编码写入，读取时新增容错解码（UTF-8 BOM → GB18030 → 替换非法字节兜底），单个坏文件不再让整轮扫描失败
- 修复卸载脚本不存在：install.ps1 未把 uninstall.ps1 复制到安装目录，导致卸载时报"-File 形式参数的实际参数不存在"
- 修复 DeepSeek 充值登记粘贴识别漏单：金额带千分位分隔符（如 `¥1,000`）时整行无法识别、不入账；金额正则新增千分位（含全角逗号）支持，解析时去除分隔符
- 去除服务端硬编码 IP：`docker-compose.yml`、`mhc-api/main.py`、`mhc-api/app/routers/usage.py` 内的默认地址 `192.168.0.193` 改为统一从项目根目录 `.env` 的 `MHC_HOST` 读取，未配置时启动即报错（不再静默回退到错误地址）

### 新增

- DeepSeek 统计页新增「各 Key 用量与占比（按时间维度）」卡片：仅需选择时间区间（含近 7/30/90 天快捷），以柱状图统计该区间各 API Key 的 Tokens 与金额，并展示其占比（金额占比标注于柱顶，Tokens 柱同轴对照），附区间汇总与明细表；新增后端接口 `GET /api/deepseek/key-usage`
- 新增导航页「key归属人员」：维护每个 API Key 的归属人员（一名人员可归属多个 Key，同一 Key 只能归属一名人员、不可重复），表格支持增删改查，并集中展示未归属 Key 以便快速归属；新增后端表 `deepseek_key_owners` 与 `GET/POST /api/deepseek/key-owners`、`PUT/DELETE /api/deepseek/key-owners/{id}`
- DeepSeek 统计页新增「📊 各 Key（归属人员）用量与占比（按时间维度）」卡片：仅需选择时间区间（含近 7/30/90 天快捷），按归属人员聚合其名下全部 Key 的 Tokens 与金额并展示占比（金额占比标注于柱顶），未登记归属的 Key 归入「未归属」，附区间汇总与明细表；新增后端接口 `GET /api/deepseek/owner-usage`

## V1.0.4（2026-08-17）

### 修复

- 修复 install.ps1 / sync_tray.ps1 在 PowerShell 5.1 下中文乱码、脚本被当作文本回显：脚本文件加 UTF-8 BOM，PS 5.1 才能正确按 UTF-8 解析（uninstall.ps1 原本带 BOM 故一直正常）
- 托盘默认服务器地址支持环境变量 MHC_HOST / MHC_API_PORT / MHC_WEB_PORT（未设置时回退原默认地址）

### 新增

- 每晚 22:00 定时自动检测更新，避开用量推送时段：同步进行中或距下次同步不足 30 分钟时，推迟到同步完成后 40-60 分钟再检测

## V1.0.3（2026-08-03）

### 修复

- 修复同步失败 `unknown option --push`：调用 Python 时漏传脚本路径，导致 Python 把 `--push` 当成解释器参数
- 修复中文机器名乱码：config.json 显式按 UTF-8 读取，避免 PowerShell 5.1 按 GBK 解码把"人事138"变成"浜轰簨138"
- 修复托盘菜单被超长同步明细撑大：明细最多显示 10 个字符，完整内容悬停查看
- 修复托盘重启后图标缺失：更新时先等旧进程完全退出，再启动新实例
- 修复退出码读取失败：改用 .NET Process 替代 Start-Process，准确判断同步成功/失败

### 新增

- 自动更新：启动时检查服务器版本，发现新版自动下载、替换程序、重启托盘（保留 config.json 机器名与日志）
- 托盘菜单新增：自动更新开关、立即检查更新（显示当前版本）
- 源码下载 API：局域网电脑可用 curl 下载部署包（/api/source/download），自动排除 .env、数据库、日志等敏感文件
- 版本文件 version.txt 与使用说明书.md

## V1.0.2（2026-08-03）

- 修复同步命令参数拼接（未发布版本）

## V1.0.1（2026-08-03）

- 初版托盘工具：每 2 小时自动推送用量、开机自启、托盘菜单
