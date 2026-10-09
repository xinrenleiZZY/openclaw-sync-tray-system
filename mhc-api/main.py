"""模型健康监控中心 - FastAPI 后端

提供 OpenClaw 用量采集（虚拟机经局域网推送）、多机聚合统计、
机器状态、推送记录与系统设置等数据 API。
"""
import json
import os
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

APP_NAME = "模型健康监控中心"
VERSION = "1.0.0"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.getenv("MHC_DATA_DIR", os.path.join(BASE_DIR, "data"))
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")


def require_env(name: str) -> str:
    """读取必需的环境变量；缺失时直接报错，避免静默回退到错误地址"""
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"环境变量 {name} 未配置：请在项目根目录 .env 中设置后重启服务")
    return value


app = FastAPI(title=APP_NAME, version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger("mhc_api")


DEFAULT_SETTINGS = {
    "pricing": {
        # DeepSeek v4-flash 官方价（元/1M，2026-08-17 起；空闲时段价作为默认估算单价）
        "input": 1.5,          # 输入（缓存未命中）
        "output": 4.5,         # 输出
        "cache_read": 0.05,    # 输入（缓存命中）
        "cache_write": 1.0,    # 缓存写入（无官方对应价，保留）
        "usd_to_rmb": 7.2,
    },
    # DeepSeek 官方价格参考表（2026-08-17 起生效；历史 CSV 数据仍用各自原始价）
    "deepseek_pricing": {
        "effective_date": "2026-08-17",
        "currency": "CNY",
        "unit": "元/百万 tokens",
        "models": {
            "deepseek-v4-flash": {
                "peak": {"cache_hit": 0.10, "cache_miss": 3.0, "output": 9.0},
                "off_peak": {"cache_hit": 0.05, "cache_miss": 1.5, "output": 4.5},
            },
            "deepseek-v4-pro": {
                "peak": {"cache_hit": 0.30, "cache_miss": 9.0, "output": 27.0},
                "off_peak": {"cache_hit": 0.15, "cache_miss": 4.5, "output": 13.5},
            },
        },
    },
    "server": {
        "host": require_env("MHC_HOST"),
        "api_port": int(os.getenv("MHC_API_PORT", "7601")),
        "web_port": int(os.getenv("MHC_WEB_PORT", "7600")),
    },
    "push_token": "",
    "deepseek_api_key": "",   # DeepSeek 官方 API Key，仅用于查询账户余额（不回显明文）
    "machine_aliases": {},
    "notes": "",
}


def read_settings() -> dict:
    if not os.path.exists(SETTINGS_FILE):
        return json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        merged = json.loads(json.dumps(DEFAULT_SETTINGS))
        for k, v in data.items():
            if isinstance(v, dict) and isinstance(merged.get(k), dict):
                merged[k].update(v)
            else:
                merged[k] = v
        return merged
    except Exception:
        return json.loads(json.dumps(DEFAULT_SETTINGS))


def write_settings(data: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ===== 基础接口 =====

@app.get("/api/health")
def health():
    return {"status": "ok", "app": APP_NAME, "version": VERSION}


@app.get("/api/info")
def get_app_info():
    return {
        "name": APP_NAME,
        "version": VERSION,
        "developer": "IT-钟",
        "phone": "18072740843",
        "description": "OpenClaw 多虚拟机用量采集与成本监控中心",
    }


# ===== 设置接口 =====

class SettingsUpdate(BaseModel):
    pricing: dict | None = None
    server: dict | None = None
    push_token: str | None = None
    deepseek_api_key: str | None = None
    machine_aliases: dict | None = None
    notes: str | None = None


@app.get("/api/settings")
def get_settings():
    settings = read_settings()
    public = {k: v for k, v in settings.items() if k not in ("push_token", "deepseek_api_key")}
    public["push_token_configured"] = bool(settings.get("push_token"))
    public["deepseek_api_key_configured"] = bool(settings.get("deepseek_api_key"))
    return public


@app.put("/api/settings")
def update_settings(update: SettingsUpdate):
    settings = read_settings()
    if update.pricing is not None:
        settings["pricing"].update(update.pricing)
    if update.server is not None:
        settings["server"].update(update.server)
    if update.push_token is not None:
        settings["push_token"] = update.push_token.strip()
    if update.deepseek_api_key is not None:
        settings["deepseek_api_key"] = update.deepseek_api_key.strip()
    if update.machine_aliases is not None:
        settings["machine_aliases"] = update.machine_aliases
    if update.notes is not None:
        settings["notes"] = update.notes
    write_settings(settings)
    return {"status": "ok", "message": "设置已保存"}


# ===== 用量路由 =====

from app.usage_db import init_db
from app.routers.usage import router as usage_router
from app.routers.source import router as source_router
from app.routers.deepseek import router as deepseek_router
from app.routers.prices import router as prices_router
from app.routers.tray import router as tray_router

app.include_router(usage_router)
app.include_router(source_router)
app.include_router(deepseek_router)
app.include_router(prices_router)
app.include_router(tray_router)


@app.on_event("startup")
def startup():
    init_db()
    _start_deepseek_balance_poller()


def _start_deepseek_balance_poller():
    """后台线程：配置了 DeepSeek API Key 时每小时拉取一次余额快照"""
    import threading
    import time

    def _loop():
        from app.usage_db import SessionLocal
        from app.routers.deepseek import refresh_balance_snapshot
        time.sleep(3)  # 等表结构就绪
        while True:
            try:
                db = SessionLocal()
                try:
                    refresh_balance_snapshot(db)
                finally:
                    db.close()
            except Exception:
                logger.exception("Deepseek 余额轮询失败")
            time.sleep(3600)

    threading.Thread(target=_loop, daemon=True).start()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
