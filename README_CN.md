# 模型健康监控中心 (MHC)

基于 **Next.js 15 + FastAPI + PostgreSQL** 等现代 Web 技术栈独立开发的多机
**OpenClaw 用量采集与成本监控系统**（基于自身技术栈构建，未依赖任何第三方业务框架）。

各虚拟机上的采集端 `openclaw_usage_stats.py` 读取 OpenClaw 网关的用量缓存
（`.usage-cost-cache.json` / 会话 `.jsonl`），统计真实 token 用量与成本，经局域网
推送到本机 `192.168.0.193:7601`，系统统一入库、去重并多维可视化展示。

## 技术栈

| 层               | 技术                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| 前端             | Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · ECharts 6 |
| 后端             | FastAPI · SQLAlchemy 2 · Pydantic 2 · Uvicorn                                |
| 数据库           | PostgreSQL 16                                                                |
| 部署             | Docker Compose                                                               |
| 采集端 Agent     | Python（`openclaw_usage_stats.py --push`）                                   |
| Windows 托盘工具 | PowerShell + WinForms（`openclaw-sync-tray`）                                |
| 可视化           | ECharts 图表 · 大屏/仪表盘/生命形态折线                                      |

## 端口规划（已检查本机占用）

| 服务    | 端口 | 说明                                |
| ------- | ---- | ----------------------------------- |
| mhc-web | 7600 | Web 前端（Next.js 15）              |
| mhc-api | 7601 | API 后端（FastAPI），虚拟机推送入口 |
| mhc-db  | 7602 | PostgreSQL                          |

> 本机 7500 / 7502 已被原 HZX 系统占用，故新系统使用 7600-7602 段。

## 部署

```bash
docker compose up -d --build
```

启动后访问：

- 管理界面: http://192.168.0.193:7600
- API 文档: http://192.168.0.193:7601/docs
- 健康检查: http://192.168.0.193:7601/api/health

## 虚拟机推送（核心用法）

把 `openclaw_usage_stats.py` 拷贝到每台运行 OpenClaw 的虚拟机，执行：

```bash
python openclaw_usage_stats.py --push --server http://192.168.0.193:7601 --machine vm-01
```

- `--server`：监控中心 API 地址
- `--machine`：机器唯一标识（建议 vm-01 / vm-02...，默认取主机名）
- 重复执行自动去重（按 机器+会话文件+时间戳+模型 唯一约束）
- 建议每天通过计划任务推送 1 次，或每次用量统计后手动推送

## Windows 托盘工具（可选，推荐）

在每台虚拟机安装托盘常驻工具 `openclaw-sync-tray`，可每 2 小时自动推送、开机自启、
右键菜单立即同步/开关、自动更新。详见 [openclaw-sync-tray/README.md](openclaw-sync-tray/README.md)。

## 本地直接运行（不装 Docker）

后端（SQLite 兜底）：

```bash
cd mhc-api
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 7601
```

前端：

```bash
cd mhc-web
npm install
npm run dev   # API_BASE_URL 默认 http://localhost:7601
```

## 主要 API

### 用量（OpenClaw 机器维度）

| 方法   | 路径                         | 说明                          |
| ------ | ---------------------------- | ----------------------------- |
| POST   | /api/usage/push              | 虚拟机推送用量（去重入库）    |
| GET    | /api/usage/overview          | 全局概览 + 近 N 天趋势        |
| GET    | /api/usage/machines          | 机器列表与聚合统计            |
| GET    | /api/usage/machines/{name}   | 单机详情（agent/model/day）   |
| PUT    | /api/usage/machines/{name}   | 修改机器显示名/备注           |
| DELETE | /api/usage/machines/{name}   | 删除机器及其用量数据          |
| GET    | /api/usage/agents            | 按 Agent 汇总                 |
| GET    | /api/usage/models            | 按模型汇总                    |
| GET    | /api/usage/days              | 按日期汇总                    |
| GET    | /api/usage/sessions          | 会话 Top                      |
| GET    | /api/usage/pushes            | 推送记录                      |
| GET    | /api/usage/entries           | 原始记录分页                  |
| GET    | /api/usage/abnormal-machines | 异常机器（最近 N 分钟未推送） |
| GET    | /api/usage/hourly            | 按小时统计（生命形态折线）    |
| GET    | /api/usage/machine-rank      | 机器成本排行                  |
| GET    | /api/usage/machine-daily     | 按日期各机器用量              |
| GET    | /api/usage/screen            | 可视化大屏聚合数据            |

### DeepSeek 账号维度

| 方法 | 路径                          | 说明                       |
| ---- | ----------------------------- | -------------------------- |
| POST | /api/deepseek/upload          | 上传 amount / cost CSV     |
| GET  | /api/deepseek/overview        | 账号用量总览 + 趋势 + 排行 |
| GET  | /api/deepseek/screen          | DeepSeek 可视化大屏数据    |
| GET  | /api/deepseek/balance         | 账户余额汇总               |
| POST | /api/deepseek/balance/refresh | 立即拉取余额快照           |
| POST | /api/deepseek/topups/parse    | 粘贴充值订单自动登记       |
| GET  | /api/deepseek/topups          | 充值登记记录列表           |
| GET  | /api/deepseek/imports         | 上传记录                   |

### 托盘同步

| 方法 | 路径                   | 说明                 |
| ---- | ---------------------- | -------------------- |
| POST | /api/tray/sync/request | 网页触发全体托盘同步 |
| GET  | /api/tray/sync/poll    | 托盘轮询是否待同步   |
| POST | /api/tray/sync/ack     | 托盘确认已同步       |
| GET  | /api/tray/sync/status  | 同步纪元与已消费机器 |

### 其他

| 方法      | 路径                   | 说明                                |
| --------- | ---------------------- | ----------------------------------- |
| GET / PUT | /api/settings          | 系统设置                            |
| GET       | /api/model-prices      | 模型价格台账列表                    |
| POST      | /api/model-prices      | 新增价格时期                        |
| PUT       | /api/model-prices/{id} | 编辑/启停价格时期                   |
| DELETE    | /api/model-prices/{id} | 删除价格时期                        |
| GET       | /api/source/version    | 版本号                              |
| GET       | /api/source/download   | 下载部署包（zip，target=tray/full） |
