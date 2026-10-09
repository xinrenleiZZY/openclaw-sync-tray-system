"""模型健康监控中心 - 用量采集与汇总 API"""
import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.usage_db import get_db
from app.usage_db import engine
from app.models.usage import Machine, UsageEntry, PushRecord

router = APIRouter(prefix="/api/usage", tags=["用量统计"])

SH_TZ = ZoneInfo("Asia/Shanghai")
DEFAULT_SETTINGS_FILE = os.getenv("MHC_SETTINGS_FILE", "")


def require_env(name: str) -> str:
    """读取必需的环境变量；缺失时直接报错，避免静默回退到错误地址"""
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"环境变量 {name} 未配置：请在项目根目录 .env 中设置后重启服务")
    return value


def read_settings():
    """读取 data/settings.json（无则返回默认）"""
    path = DEFAULT_SETTINGS_FILE
    if not path:
        data_dir = os.getenv("MHC_DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data"))
        path = os.path.join(data_dir, "settings.json")
    defaults = {
        "pricing": {"input": 1.5, "output": 4.5, "cache_read": 0.05, "cache_write": 1.0, "usd_to_rmb": 7.2},
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
        "machine_aliases": {},
        "notes": "",
    }
    if not os.path.exists(path):
        return defaults
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        merged = json.loads(json.dumps(defaults))
        for k, v in data.items():
            if isinstance(v, dict) and isinstance(defaults.get(k), dict):
                merged[k].update(v)
            else:
                merged[k] = v
        return merged
    except Exception:
        return defaults


def sh_now() -> datetime:
    return datetime.now(SH_TZ)


def scope_filter(scope: str):
    """生成范围过滤条件：scope='deepseek' 时按 provider/model 关键字判定，否则不限制。"""
    if scope == "deepseek":
        return or_(
            UsageEntry.provider.ilike("%deepseek%"),
            UsageEntry.model.ilike("%deepseek%"),
        )
    return None


def sh_day_from_utc(dt: datetime) -> str:
    return dt.astimezone(SH_TZ).strftime("%Y-%m-%d")


def utc_from_ms(ts_ms: int) -> datetime:
    if not ts_ms:
        return datetime.utcnow()
    return datetime.fromtimestamp(ts_ms / 1000, tz=ZoneInfo("UTC")).replace(tzinfo=None)


# ===== 数据模型（接收推送） =====

class EntryIn(BaseModel):
    session_file: str = ""
    session_id: str = ""
    agent: str = ""
    provider: str = ""
    model: str = "?"
    timestamp: int = 0
    input: int = 0
    output: int = 0
    cacheRead: int = 0
    cacheWrite: int = 0
    totalTokens: int = 0
    totalCost: float = 0.0


class PushIn(BaseModel):
    machine: str = Field(..., description="机器标识，如 vm-01")
    hostname: str = ""
    os: str = ""
    reported_at: str = ""
    entries: list[EntryIn] = []


class MachineUpdate(BaseModel):
    alias: str | None = None
    notes: str | None = None
    enabled: bool | None = None


# ===== 工具 =====

def _entry_row(e: EntryIn, machine: str) -> dict:
    ts = utc_from_ms(e.timestamp)
    agent = (e.agent or "").strip()
    if not agent:
        # 从 session_file 路径推断 agent：...agents/<agent>/sessions/...
        parts = e.session_file.replace("\\", "/").split("/")
        for i, p in enumerate(parts):
            if p == "agents" and i + 1 < len(parts):
                agent = parts[i + 1]
                break
    # 按数据库列宽截断，避免个别超长值（如异常 session_id/model）导致整批推送 500
    return {
        "machine": machine[:100],
        "session_file": (e.session_file or "")[:600],
        "session_id": (e.session_id or "")[:120],
        "agent": (agent or "unknown")[:100],
        "provider": (e.provider or "")[:120],
        "model": (e.model or "?")[:120],
        "ts": ts,
        "day": sh_day_from_utc(ts),
        "input_tokens": e.input or 0,
        "output_tokens": e.output or 0,
        "cache_read": e.cacheRead or 0,
        "cache_write": e.cacheWrite or 0,
        "total_tokens": e.totalTokens or 0,
        "total_cost": e.totalCost or 0.0,
        "received_at": datetime.now(),
    }


def _upsert_machine(db: Session, name: str, hostname: str, os_info: str, entries_count: int, total_cost: float):
    now = datetime.now()
    m = db.query(Machine).filter(Machine.name == name).first()
    if not m:
        m = Machine(name=name, hostname=hostname, os_info=os_info, first_seen=now, last_seen=now, last_cost=total_cost, last_entries=entries_count)
        db.add(m)
    else:
        m.last_seen = now
        m.last_cost = total_cost
        m.last_entries = entries_count
        if hostname:
            m.hostname = hostname
        if os_info:
            m.os_info = os_info
    m.last_report = now.strftime("%Y-%m-%d %H:%M:%S")
    db.flush()
    return m


# 机器详细信息字段（部门/机器人名称/ip地址/用户名/API Key/账号/密码等）
# 数据源：飞书 Wiki「openclaw登记」电子表格，按 hostname / ip / 机器名匹配填充
_EMPTY_MACHINE_INFO = {
    "department": "",
    "robot_name": "",
    "ip": "",
    "username": "",
    "api_key1_name": "",
    "api_key1_short": "",
    "api_key2_name": "",
    "api_key2_short": "",
    "account": "",
    "password": "",
}


def _machine_info_for(machine: Machine) -> dict:
    """返回某台机器的详细信息（飞书「openclaw登记」按 hostname / ip / 机器名匹配填充）

    飞书不可用或未匹配时返回空结构（弹窗显示 '-'），不阻塞机器查询。
    """
    try:
        from app.feishu_sheet import get_machine_info_for

        return get_machine_info_for(
            hostname=machine.hostname or "",
            name=machine.name or "",
            alias=machine.alias or machine.name or "",
        )
    except Exception:
        return dict(_EMPTY_MACHINE_INFO)


def _machine_rows(machines: list[Machine], db: Session, filter_=None) -> list[dict]:
    """机器列表 + 聚合统计"""
    result = []
    for m in machines:
        q = db.query(
            func.count(UsageEntry.id),
            func.coalesce(func.sum(UsageEntry.input_tokens), 0),
            func.coalesce(func.sum(UsageEntry.output_tokens), 0),
            func.coalesce(func.sum(UsageEntry.cache_read), 0),
            func.coalesce(func.sum(UsageEntry.cache_write), 0),
            func.coalesce(func.sum(UsageEntry.total_tokens), 0),
            func.coalesce(func.sum(UsageEntry.total_cost), 0),
        ).filter(UsageEntry.machine == m.name)
        if filter_ is not None:
            q = q.filter(filter_)
        agg = q.first()
        result.append({
            "name": m.name,
            "alias": m.alias or m.name,
            "hostname": m.hostname,
            "os_info": m.os_info,
            "notes": m.notes or "",
            "enabled": m.enabled,
            "machine_info": _machine_info_for(m),
            "first_seen": m.first_seen.strftime("%Y-%m-%d %H:%M:%S") if m.first_seen else "",
            "last_seen": m.last_seen.strftime("%Y-%m-%d %H:%M:%S") if m.last_seen else "",
            "last_report": m.last_report,
            "last_entries": m.last_entries,
            "version": m.version or "",
            "online": bool(m.last_seen and (datetime.now() - m.last_seen).total_seconds() < 24 * 3600),
            "entries": agg[0] or 0,
            "calls": agg[0] or 0,
            "input": agg[1] or 0,
            "output": agg[2] or 0,
            "cacheRead": agg[3] or 0,
            "cacheWrite": agg[4] or 0,
            "totalTokens": agg[5] or 0,
            "totalCost": round(agg[6] or 0, 6),
        })
    return result


def _group_rows(db: Session, group_col, machine: str | None, days: int | None):
    q = db.query(
        group_col,
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.input_tokens), 0),
        func.coalesce(func.sum(UsageEntry.output_tokens), 0),
        func.coalesce(func.sum(UsageEntry.cache_read), 0),
        func.coalesce(func.sum(UsageEntry.cache_write), 0),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
    )
    if machine:
        q = q.filter(UsageEntry.machine == machine)
    if days:
        start = sh_now().date() - timedelta(days=days - 1)
        q = q.filter(UsageEntry.day >= start.strftime("%Y-%m-%d"))
    q = q.group_by(group_col).order_by(func.coalesce(func.sum(UsageEntry.total_cost), 0).desc())
    rows = []
    for r in q.all():
        rows.append({
            "name": r[0],
            "entries": r[1] or 0,
            "calls": r[1] or 0,
            "input": r[2] or 0,
            "output": r[3] or 0,
            "cacheRead": r[4] or 0,
            "cacheWrite": r[5] or 0,
            "totalTokens": r[6] or 0,
            "totalCost": round(r[7] or 0, 6),
        })
    return rows


# ===== 采集入口（虚拟机推送） =====

@router.post("/push")
def push_usage(payload: PushIn, request: Request, db: Session = Depends(get_db)):
    """接收虚拟机 OpenClaw 用量推送，去重入库。"""
    machine = (payload.machine or "").strip()
    if not machine:
        raise HTTPException(status_code=400, detail="缺少 machine 字段")
    if len(machine) > 100:
        raise HTTPException(status_code=400, detail="machine 过长")

    # 可选推送令牌校验
    expected_token = os.getenv("MHC_PUSH_TOKEN", "") or read_settings().get("push_token", "")
    if expected_token:
        got = request.headers.get("X-Push-Token", "")
        if got != expected_token:
            raise HTTPException(status_code=401, detail="推送令牌无效")

    # 过滤全零条目（网关注入的空记录）
    valid = [e for e in payload.entries if (e.input or e.output or e.cacheRead or e.cacheWrite or e.totalCost)]
    if not valid:
        _upsert_machine(db, machine, payload.hostname, payload.os, 0, 0.0)
        db.commit()
        return {"status": "ok", "machine": machine, "entries_count": 0, "inserted": 0, "duplicates": 0, "total_cost": 0.0, "message": "无有效用量条目"}

    before = db.query(func.count(UsageEntry.id)).filter(UsageEntry.machine == machine).scalar() or 0

    rows = [_entry_row(e, machine) for e in valid]
    conflict_cols = ["machine", "session_file", "ts", "model"]
    if engine.dialect.name == "postgresql":
        stmt = pg_insert(UsageEntry).values(rows).on_conflict_do_nothing(index_elements=conflict_cols)
    else:
        stmt = sqlite_insert(UsageEntry).values(rows).on_conflict_do_nothing(index_elements=conflict_cols)
    db.execute(stmt)

    after = db.query(func.count(UsageEntry.id)).filter(UsageEntry.machine == machine).scalar() or 0
    inserted = after - before
    duplicates = len(rows) - inserted

    total_cost = sum(r["total_cost"] for r in rows)
    total_tokens = sum(r["total_tokens"] for r in rows)

    _upsert_machine(db, machine, payload.hostname, payload.os, len(rows), total_cost)

    # 模型 Top 摘要
    model_totals: dict[str, float] = {}
    for r in rows:
        model_totals[r["model"]] = round(model_totals.get(r["model"], 0) + r["total_cost"], 6)
    top_models = sorted(model_totals.items(), key=lambda x: -x[1])[:8]
    detail = json.dumps({
        "totals": {"cost": round(total_cost, 6), "tokens": total_tokens, "calls": len(rows)},
        "top_models": [{"model": k, "cost": v} for k, v in top_models],
    }, ensure_ascii=False)

    push = PushRecord(
        machine=machine,
        entries_count=len(rows),
        inserted=inserted,
        duplicates=duplicates,
        total_cost=round(total_cost, 6),
        total_tokens=total_tokens,
        detail=detail,
    )
    db.add(push)
    db.commit()

    return {
        "status": "ok",
        "machine": machine,
        "entries_count": len(rows),
        "inserted": inserted,
        "duplicates": duplicates,
        "total_cost": round(total_cost, 6),
        "total_tokens": total_tokens,
    }


# ===== 查询接口 =====

@router.get("/overview")
def get_overview(days: int = 7, scope: str = "all", db: Session = Depends(get_db)):
    """全局概览：机器数 / 总用量 / 今日 / 近 N 天趋势

    scope：'all'（全部模型，默认）或 'deepseek'（按 provider/model 关键字判定）。
    """
    if scope not in ("all", "deepseek"):
        scope = "all"
    f = scope_filter(scope)

    machines = db.query(func.count(Machine.id)).scalar() or 0
    totals_q = db.query(
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.input_tokens), 0),
        func.coalesce(func.sum(UsageEntry.output_tokens), 0),
        func.coalesce(func.sum(UsageEntry.cache_read), 0),
        func.coalesce(func.sum(UsageEntry.cache_write), 0),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
    )
    if f is not None:
        totals_q = totals_q.filter(f)
    totals = totals_q.first()

    today = sh_now().strftime("%Y-%m-%d")
    today_q = db.query(
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
    ).filter(UsageEntry.day == today)
    if f is not None:
        today_q = today_q.filter(f)
    today_row = today_q.first()

    trend_q = db.query(
        UsageEntry.day,
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.input_tokens), 0),
        func.coalesce(func.sum(UsageEntry.output_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
    )
    if f is not None:
        trend_q = trend_q.filter(f)
    trend_q = trend_q.group_by(UsageEntry.day).order_by(UsageEntry.day.desc()).limit(days).all()

    # 补齐缺失日期
    trend_map = {r[0]: r for r in trend_q}
    trend = []
    for i in range(days - 1, -1, -1):
        d = (sh_now().date() - timedelta(days=i)).strftime("%Y-%m-%d")
        r = trend_map.get(d)
        trend.append({
            "date": d,
            "calls": r[1] or 0 if r else 0,
            "input": r[2] or 0 if r else 0,
            "output": r[3] or 0 if r else 0,
            "cost": round(r[4] or 0, 6) if r else 0,
        })

    top_machines = _machine_rows(db.query(Machine).order_by(Machine.last_seen.desc()).all(), db, f)[:10]

    return {
        "machines": machines,
        "entries": totals[0] or 0,
        "calls": totals[0] or 0,
        "input": totals[1] or 0,
        "output": totals[2] or 0,
        "cacheRead": totals[3] or 0,
        "cacheWrite": totals[4] or 0,
        "totalTokens": totals[5] or 0,
        "totalCost": round(totals[6] or 0, 6),
        "today_calls": today_row[0] or 0,
        "today_cost": round(today_row[1] or 0, 6),
        "today_tokens": today_row[2] or 0,
        "trend": trend,
        "top_machines": top_machines,
    }


@router.get("/machines")
def get_machines(db: Session = Depends(get_db)):
    """所有机器及聚合统计"""
    machines = db.query(Machine).order_by(Machine.last_seen.desc()).all()
    return {"machines": _machine_rows(machines, db), "total": len(machines)}


@router.get("/abnormal-machines")
def get_abnormal_machines(threshold_minutes: int = 120, db: Session = Depends(get_db)):
    """异常机器：最近 threshold_minutes 分钟内无推送记录即视为异常（默认 2 小时）。

    判定基于每台机器最近一次推送记录（PushRecord.received_at），
    从未推送过的机器同样视为异常。
    """
    threshold_minutes = max(10, min(threshold_minutes, 24 * 60))
    cutoff = datetime.now() - timedelta(minutes=threshold_minutes)

    machines = db.query(Machine).all()
    last_push_rows = db.query(
        PushRecord.machine,
        func.max(PushRecord.received_at),
    ).group_by(PushRecord.machine).all()
    last_push_map = {r[0]: r[1] for r in last_push_rows}

    now = datetime.now()
    items = []
    for m in machines:
        last_seen = m.last_seen
        last_push = last_push_map.get(m.name)
        # 以机器最近一次成功上报（last_seen，任何 /push 都会刷新，含全零心跳）判定存活；
        # last_push（仅记录"有有效条目"的推送）只作为"最近有效推送"展示，不参与异常判定。
        if last_seen is not None and last_seen >= cutoff:
            continue
        idle_seconds = round((now - last_seen).total_seconds()) if last_seen else None
        items.append({
            "name": m.name,
            "alias": m.alias or m.name,
            "hostname": m.hostname,
            "os_info": m.os_info,
            "notes": m.notes or "",
            "enabled": m.enabled,
            "last_seen": last_seen.strftime("%Y-%m-%d %H:%M:%S") if last_seen else "",
            "last_push": last_push.strftime("%Y-%m-%d %H:%M:%S") if last_push else "",
            "idle_seconds": idle_seconds,
        })

    # 未推送（None → 最大）排最前，其余按异常时长从长到短
    items.sort(key=lambda x: (x["idle_seconds"] if x["idle_seconds"] is not None else float("inf")), reverse=True)

    return {
        "threshold_minutes": threshold_minutes,
        "total_machines": len(machines),
        "abnormal_count": len(items),
        "items": items,
    }


@router.get("/machines/{machine_name}")
def get_machine_detail(machine_name: str, db: Session = Depends(get_db)):
    """单台机器详情（含按 agent / model / day 拆分）"""
    m = db.query(Machine).filter(Machine.name == machine_name).first()
    if not m:
        raise HTTPException(status_code=404, detail="机器不存在")
    rows = _machine_rows([m], db)
    return {
        "machine": rows[0],
        "agents": _group_rows(db, UsageEntry.agent, machine_name, None),
        "models": _group_rows(db, UsageEntry.model, machine_name, None),
        "days": _group_rows(db, UsageEntry.day, machine_name, None),
    }


@router.put("/machines/{machine_name}")
def update_machine(machine_name: str, update: MachineUpdate, db: Session = Depends(get_db)):
    """更新机器显示名 / 备注 / 启停"""
    m = db.query(Machine).filter(Machine.name == machine_name).first()
    if not m:
        raise HTTPException(status_code=404, detail="机器不存在")
    if update.alias is not None:
        m.alias = update.alias
    if update.notes is not None:
        m.notes = update.notes
    if update.enabled is not None:
        m.enabled = update.enabled
    db.commit()
    return {"status": "ok", "machine": machine_name}


@router.delete("/machines/{machine_name}")
def delete_machine(machine_name: str, db: Session = Depends(get_db)):
    """删除机器及其全部用量明细与推送记录（不可恢复）"""
    m = db.query(Machine).filter(Machine.name == machine_name).first()
    if not m:
        raise HTTPException(status_code=404, detail="机器不存在")
    entries = db.query(func.count(UsageEntry.id)).filter(UsageEntry.machine == machine_name).scalar() or 0
    pushes = db.query(func.count(PushRecord.id)).filter(PushRecord.machine == machine_name).scalar() or 0
    db.query(UsageEntry).filter(UsageEntry.machine == machine_name).delete(synchronize_session=False)
    db.query(PushRecord).filter(PushRecord.machine == machine_name).delete(synchronize_session=False)
    db.delete(m)
    db.commit()
    return {
        "status": "ok",
        "machine": machine_name,
        "deleted_entries": entries,
        "deleted_pushes": pushes,
        "message": f"机器 {machine_name} 及其用量数据已删除",
    }


@router.get("/agents")
def get_agents(machine: str | None = None, days: int | None = None, db: Session = Depends(get_db)):
    """按 agent 汇总（可过滤机器 / 最近天数）"""
    return {"items": _group_rows(db, UsageEntry.agent, machine, days)}


@router.get("/models")
def get_models(machine: str | None = None, days: int | None = None, db: Session = Depends(get_db)):
    """按模型汇总"""
    return {"items": _group_rows(db, UsageEntry.model, machine, days)}


@router.get("/days")
def get_days(machine: str | None = None, days: int = 30, db: Session = Depends(get_db)):
    """按日期汇总（近 N 天，降序，最新日期在前）"""
    rows = _group_rows(db, UsageEntry.day, machine, days)
    rows.sort(key=lambda x: x["name"], reverse=True)
    return {"items": rows}


@router.get("/sessions")
def get_sessions(machine: str | None = None, limit: int = 20, db: Session = Depends(get_db)):
    """按会话文件汇总（Top）"""
    q = db.query(
        UsageEntry.machine,
        UsageEntry.agent,
        UsageEntry.session_id,
        UsageEntry.session_file,
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.input_tokens), 0),
        func.coalesce(func.sum(UsageEntry.output_tokens), 0),
        func.coalesce(func.sum(UsageEntry.cache_read), 0),
        func.coalesce(func.sum(UsageEntry.cache_write), 0),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
        func.max(UsageEntry.ts),
    )
    if machine:
        q = q.filter(UsageEntry.machine == machine)
    q = q.group_by(UsageEntry.machine, UsageEntry.agent, UsageEntry.session_id, UsageEntry.session_file) \
        .order_by(func.coalesce(func.sum(UsageEntry.total_cost), 0).desc()).limit(min(limit, 200))
    items = []
    for r in q.all():
        items.append({
            "machine": r[0],
            "agent": r[1],
            "session_id": r[2],
            "session_file": r[3],
            "entries": r[4] or 0,
            "input": r[5] or 0,
            "output": r[6] or 0,
            "cacheRead": r[7] or 0,
            "cacheWrite": r[8] or 0,
            "totalTokens": r[9] or 0,
            "totalCost": round(r[10] or 0, 6),
            "last_ts": r[11].strftime("%Y-%m-%d %H:%M:%S") if r[11] else "",
        })
    return {"items": items, "total": len(items)}


@router.get("/pushes")
def get_pushes(machine: str | None = None, limit: int = 20, db: Session = Depends(get_db)):
    """最近推送记录"""
    q = db.query(PushRecord)
    if machine:
        q = q.filter(PushRecord.machine == machine)
    rows = q.order_by(PushRecord.received_at.desc()).limit(min(limit, 200)).all()
    items = []
    for p in rows:
        detail = {}
        try:
            detail = json.loads(p.detail or "{}")
        except Exception:
            pass
        items.append({
            "id": p.id,
            "machine": p.machine,
            "received_at": p.received_at.strftime("%Y-%m-%d %H:%M:%S") if p.received_at else "",
            "entries_count": p.entries_count,
            "inserted": p.inserted,
            "duplicates": p.duplicates,
            "total_cost": round(p.total_cost, 6),
            "total_tokens": p.total_tokens,
            "detail": detail,
        })
    return {"items": items, "total": len(items)}


@router.get("/entries")
def get_entries(
    machine: str | None = None,
    agent: str | None = None,
    model: str | None = None,
    day: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """原始用量记录分页"""
    q = db.query(UsageEntry)
    if machine:
        q = q.filter(UsageEntry.machine == machine)
    if agent:
        q = q.filter(UsageEntry.agent == agent)
    if model:
        q = q.filter(UsageEntry.model == model)
    if day:
        q = q.filter(UsageEntry.day == day)
    total = q.count()
    rows = q.order_by(UsageEntry.ts.desc()).offset(max(offset, 0)).limit(min(limit, 200)).all()
    items = [{
        "id": r.id,
        "machine": r.machine,
        "session_file": r.session_file,
        "session_id": r.session_id,
        "agent": r.agent,
        "provider": r.provider,
        "model": r.model,
        "ts": r.ts.strftime("%Y-%m-%d %H:%M:%S") if r.ts else "",
        "day": r.day,
        "input": r.input_tokens,
        "output": r.output_tokens,
        "cacheRead": r.cache_read,
        "cacheWrite": r.cache_write,
        "totalTokens": r.total_tokens,
        "totalCost": round(r.total_cost or 0, 6),
    } for r in rows]
    return {"items": items, "total": total}


@router.get("/machine-daily")
def get_machine_daily(day: str | None = None, db: Session = Depends(get_db)):
    """按日期查看各机器使用量（未传 day 时默认今天）"""
    target = day or sh_now().strftime("%Y-%m-%d")
    rows = db.query(
        UsageEntry.machine,
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.input_tokens), 0),
        func.coalesce(func.sum(UsageEntry.output_tokens), 0),
        func.coalesce(func.sum(UsageEntry.cache_read), 0),
        func.coalesce(func.sum(UsageEntry.cache_write), 0),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
    ).filter(UsageEntry.day == target).group_by(UsageEntry.machine).all()

    machines = {m.name: m for m in db.query(Machine).all()}
    items = []
    for r in rows:
        m = machines.get(r[0])
        items.append({
            "machine": r[0],
            "alias": (m.alias or r[0]) if m else r[0],
            "calls": r[1] or 0,
            "input": r[2] or 0,
            "output": r[3] or 0,
            "cacheRead": r[4] or 0,
            "cacheWrite": r[5] or 0,
            "tokens": r[6] or 0,
            "cost": round(r[7] or 0, 6),
        })
    items.sort(key=lambda x: -x["cost"])
    return {"day": target, "items": items}


@router.get("/machine-rank")
def get_machine_rank(days: int = 30, db: Session = Depends(get_db)):
    """机器成本排行（近 N 天），含每日成本明细，用于每日消耗排行"""
    days = min(max(days, 1), 365)
    end = sh_now().strftime("%Y-%m-%d")
    start = (sh_now().date() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    rows = db.query(
        UsageEntry.machine,
        UsageEntry.day,
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.input_tokens), 0),
        func.coalesce(func.sum(UsageEntry.output_tokens), 0),
        func.coalesce(func.sum(UsageEntry.cache_read), 0),
        func.coalesce(func.sum(UsageEntry.cache_write), 0),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
    ).filter(UsageEntry.day >= start, UsageEntry.day <= end).group_by(UsageEntry.machine, UsageEntry.day).all()

    dates = [(sh_now().date() - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days - 1, -1, -1)]
    machines = {m.name: m for m in db.query(Machine).all()}
    by_machine: dict[str, dict] = {}
    for r in rows:
        m = machines.get(r[0])
        bucket = by_machine.setdefault(r[0], {
            "machine": r[0],
            "alias": (m.alias or r[0]) if m else r[0],
            "calls": 0,
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0,
            "tokens": 0,
            "cost": 0.0,
            "daily": {},
        })
        bucket["calls"] += r[2] or 0
        bucket["input"] += r[3] or 0
        bucket["output"] += r[4] or 0
        bucket["cacheRead"] += r[5] or 0
        bucket["cacheWrite"] += r[6] or 0
        bucket["tokens"] += r[7] or 0
        bucket["cost"] += r[8] or 0
        bucket["daily"][r[1]] = round(r[8] or 0, 6)

    items = sorted(by_machine.values(), key=lambda x: -x["cost"])
    for it in items:
        it["cost"] = round(it["cost"], 6)
        it["daily"] = {d: it["daily"].get(d, 0) for d in dates}
    return {"days": dates, "start": start, "end": end, "items": items}


@router.get("/hourly")
def get_hourly(hours: int = 24, db: Session = Depends(get_db)):
    """按小时维度统计各机器成本（近 N 小时），供仪表盘"生命形态"实时折线。

    注意：UsageEntry.ts 存的是 UTC（naive），上海为 UTC+8，归桶时加 8 小时。
    """
    hours = min(max(hours, 6), 168)
    now_utc = datetime.utcnow()
    start = (now_utc - timedelta(hours=hours - 1)).replace(minute=0, second=0, microsecond=0)
    # 轴与桶统一用上海时间（UTC+8）
    start_sh = start + timedelta(hours=8)
    rows = db.query(UsageEntry.machine, UsageEntry.ts, UsageEntry.total_cost, UsageEntry.total_tokens).filter(UsageEntry.ts >= start).all()

    alias_map = {m.name: (m.alias or m.name) for m in db.query(Machine).all()}
    cost_buckets: dict[str, dict[str, float]] = {}
    token_buckets: dict[str, dict[str, int]] = {}
    for machine, ts, cost, tokens in rows:
        hk = (ts + timedelta(hours=8)).strftime("%Y-%m-%d %H:00")
        cost_buckets.setdefault(machine, {}).setdefault(hk, 0.0)
        cost_buckets[machine][hk] += round(cost or 0, 6)
        token_buckets.setdefault(machine, {}).setdefault(hk, 0)
        token_buckets[machine][hk] += tokens or 0

    hour_keys = [(start_sh + timedelta(hours=i)).strftime("%Y-%m-%d %H:00") for i in range(hours)]
    machines = []
    for machine in cost_buckets:
        c_b = cost_buckets[machine]
        t_b = token_buckets.get(machine, {})
        machines.append({
            "name": machine,
            "alias": alias_map.get(machine, machine),
            "total_cost": round(sum(c_b.values()), 6),
            "total_tokens": sum(t_b.values()),
            "data": [round(c_b.get(hk, 0), 6) for hk in hour_keys],
            "token_data": [t_b.get(hk, 0) for hk in hour_keys],
        })
    machines.sort(key=lambda m: -m["total_cost"])

    return {
        "hours": [hk[5:] for hk in hour_keys],  # MM-DD HH:00
        "hour_keys": hour_keys,
        "start": hour_keys[0],
        "end": hour_keys[-1],
        "machines": machines[:20],
    }


@router.get("/screen")
def get_screen(days: int = 30, db: Session = Depends(get_db)):
    """可视化大屏聚合数据（一次返回所有图表所需数据）"""
    machines = db.query(func.count(Machine.id)).scalar() or 0
    totals = db.query(
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.input_tokens), 0),
        func.coalesce(func.sum(UsageEntry.output_tokens), 0),
        func.coalesce(func.sum(UsageEntry.cache_read), 0),
        func.coalesce(func.sum(UsageEntry.cache_write), 0),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
    ).first()

    today = sh_now().strftime("%Y-%m-%d")
    today_row = db.query(
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
    ).filter(UsageEntry.day == today).first()

    # 近 N 天按日趋势
    trend_q = db.query(
        UsageEntry.day,
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.input_tokens), 0),
        func.coalesce(func.sum(UsageEntry.output_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
    ).group_by(UsageEntry.day).order_by(UsageEntry.day.desc()).limit(days).all()
    trend_map = {r[0]: r for r in trend_q}
    trend = []
    for i in range(days - 1, -1, -1):
        d = (sh_now().date() - timedelta(days=i)).strftime("%Y-%m-%d")
        r = trend_map.get(d)
        trend.append({
            "date": d,
            "calls": r[1] or 0 if r else 0,
            "input": r[2] or 0 if r else 0,
            "output": r[3] or 0 if r else 0,
            "tokens": r[4] or 0 if r else 0,
            "cost": round(r[5] or 0, 6) if r else 0,
        })

    # 模型 x 日期趋势（近 14 天）
    model_days = min(days, 14)
    mstart = (sh_now().date() - timedelta(days=model_days - 1)).strftime("%Y-%m-%d")
    model_rows = db.query(
        UsageEntry.day,
        UsageEntry.model,
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.input_tokens), 0),
        func.coalesce(func.sum(UsageEntry.output_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
    ).filter(UsageEntry.day >= mstart).group_by(UsageEntry.day, UsageEntry.model).order_by(UsageEntry.day).all()
    model_trend = [{
        "day": r[0],
        "model": r[1],
        "calls": r[2] or 0,
        "input": r[3] or 0,
        "output": r[4] or 0,
        "cost": round(r[5] or 0, 6),
    } for r in model_rows]

    # 会话 Top 10
    session_q = db.query(
        UsageEntry.machine,
        UsageEntry.agent,
        UsageEntry.session_id,
        UsageEntry.session_file,
        func.count(UsageEntry.id),
        func.coalesce(func.sum(UsageEntry.total_tokens), 0),
        func.coalesce(func.sum(UsageEntry.total_cost), 0),
    ).group_by(UsageEntry.machine, UsageEntry.agent, UsageEntry.session_id, UsageEntry.session_file) \
        .order_by(func.coalesce(func.sum(UsageEntry.total_cost), 0).desc()).limit(10).all()
    sessions = [{
        "machine": r[0],
        "agent": r[1],
        "session_id": r[2],
        "session_file": r[3],
        "calls": r[4] or 0,
        "tokens": r[5] or 0,
        "cost": round(r[6] or 0, 6),
    } for r in session_q]

    return {
        "machines": machines,
        "calls": totals[0] or 0,
        "input": totals[1] or 0,
        "output": totals[2] or 0,
        "cacheRead": totals[3] or 0,
        "cacheWrite": totals[4] or 0,
        "totalTokens": totals[5] or 0,
        "totalCost": round(totals[6] or 0, 6),
        "today_calls": today_row[0] or 0,
        "today_cost": round(today_row[1] or 0, 6),
        "today_tokens": today_row[2] or 0,
        "trend": trend,
        "model_rank": _group_rows(db, UsageEntry.model, None, days),
        "agent_rank": _group_rows(db, UsageEntry.agent, None, days),
        "machine_rank": _machine_rows(db.query(Machine).order_by(Machine.last_seen.desc()).all(), db),
        "model_trend": model_trend,
        "sessions": sessions,
    }
