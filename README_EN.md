# Model Health Monitor (MHC)

A multi-machine **OpenClaw usage collection & cost monitoring system** built from scratch on a
modern Web stack — **Next.js 15 + FastAPI + PostgreSQL** (standalone, not based on any third-party
business framework).

The agent `openclaw_usage_stats.py` on each VM reads OpenClaw gateway usage caches
(`.usage-cost-cache.json` / session `.jsonl`), computes real token usage and cost, and pushes them
over LAN to `192.168.0.193:7601`. The system stores, de-duplicates, and visualizes the data.

## Tech Stack

| Layer             | Technology                                                                   |
| ----------------- | ---------------------------------------------------------------------------- |
| Frontend          | Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · ECharts 6 |
| Backend           | FastAPI · SQLAlchemy 2 · Pydantic 2 · Uvicorn                                |
| Database          | PostgreSQL 16                                                                |
| Deployment        | Docker Compose                                                               |
| Agent             | Python (`openclaw_usage_stats.py --push`)                                    |
| Windows tray tool | PowerShell + WinForms (`openclaw-sync-tray`)                                 |
| Visualization     | ECharts · big-screen / dashboard / lifecycle chart                           |

## Ports (already verified free)

| Service | Port | Description                          |
| ------- | ---- | ------------------------------------ |
| mhc-web | 7600 | Web frontend (Next.js 15)            |
| mhc-api | 7601 | API backend (FastAPI), VM push entry |
| mhc-db  | 7602 | PostgreSQL                           |

> Local ports 7500 / 7502 are used by the legacy HZX system, so the new system uses 7600-7602.

## Deployment

```bash
docker compose up -d --build
```

After startup:

- Admin UI: http://192.168.0.193:7600
- API docs: http://192.168.0.193:7601/docs
- Health check: http://192.168.0.193:7601/api/health

## VM Push (core usage)

Copy `openclaw_usage_stats.py` to each VM running OpenClaw, then run:

```bash
python openclaw_usage_stats.py --push --server http://192.168.0.193:7601 --machine vm-01
```

- `--server`: monitor center API address
- `--machine`: unique machine id (recommend vm-01 / vm-02..., defaults to hostname)
- Re-running is auto de-duplicated (unique key: machine + session file + timestamp + model)
- Recommended to push once daily via Task Scheduler, or manually after each stats run

## Windows Tray Tool (optional, recommended)

Install the tray resident tool `openclaw-sync-tray` on each VM for auto-push every 2 hours,
auto-start on boot, right-click manual sync/toggle, and self-update. See
[openclaw-sync-tray/README.md](openclaw-sync-tray/README.md).

## Run Locally (without Docker)

Backend (SQLite fallback):

```bash
cd mhc-api
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 7601
```

Frontend:

```bash
cd mhc-web
npm install
npm run dev   # API_BASE_URL defaults to http://localhost:7601
```

## Main APIs

### Usage (OpenClaw machine dimension)

| Method | Path                         | Description                              |
| ------ | ---------------------------- | ---------------------------------------- |
| POST   | /api/usage/push              | Push usage from VM (dedup)               |
| GET    | /api/usage/overview          | Global overview + recent N-day trend     |
| GET    | /api/usage/machines          | Machine list + aggregated stats          |
| GET    | /api/usage/machines/{name}   | Single machine detail (agent/model/day)  |
| PUT    | /api/usage/machines/{name}   | Update machine name/notes                |
| DELETE | /api/usage/machines/{name}   | Delete machine and its usage data        |
| GET    | /api/usage/agents            | Aggregate by agent                       |
| GET    | /api/usage/models            | Aggregate by model                       |
| GET    | /api/usage/days              | Aggregate by date                        |
| GET    | /api/usage/sessions          | Top sessions                             |
| GET    | /api/usage/pushes            | Push history                             |
| GET    | /api/usage/entries           | Raw records (paginated)                  |
| GET    | /api/usage/abnormal-machines | Abnormal machines (no push in N minutes) |
| GET    | /api/usage/hourly            | Hourly stats (lifecycle chart)           |
| GET    | /api/usage/machine-rank      | Machine cost ranking                     |
| GET    | /api/usage/machine-daily     | Per-machine usage by date                |
| GET    | /api/usage/screen            | Big-screen aggregated data               |

### DeepSeek account dimension

| Method | Path                          | Description                                   |
| ------ | ----------------------------- | --------------------------------------------- |
| POST   | /api/deepseek/upload          | Upload amount / cost CSV                      |
| GET    | /api/deepseek/overview        | Account usage overview + trend + ranking      |
| GET    | /api/deepseek/screen          | DeepSeek big-screen data                      |
| GET    | /api/deepseek/balance         | Account balance summary                       |
| POST   | /api/deepseek/balance/refresh | Refresh balance snapshot now                  |
| POST   | /api/deepseek/topups/parse    | Paste top-up orders to register automatically |
| GET    | /api/deepseek/topups          | Top-up records                                |
| GET    | /api/deepseek/imports         | Upload history                                |

### Tray sync

| Method | Path                   | Description                        |
| ------ | ---------------------- | ---------------------------------- |
| POST   | /api/tray/sync/request | Web-triggered sync for all trays   |
| GET    | /api/tray/sync/poll    | Tray polls whether sync is pending |
| POST   | /api/tray/sync/ack     | Tray acknowledges sync complete    |
| GET    | /api/tray/sync/status  | Sync epoch and acked machines      |

### Others

| Method    | Path                   | Description                                     |
| --------- | ---------------------- | ----------------------------------------------- |
| GET / PUT | /api/settings          | System settings                                 |
| GET       | /api/model-prices      | Model price ledger list                         |
| POST      | /api/model-prices      | Add a price period                              |
| PUT       | /api/model-prices/{id} | Edit / enable-disable a price period            |
| DELETE    | /api/model-prices/{id} | Delete a price period                           |
| GET       | /api/source/version    | Version number                                  |
| GET       | /api/source/download   | Download deploy package (zip, target=tray/full) |
