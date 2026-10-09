"""Deepseek 用量统计中心 - 账号维度用量数据

与 OpenClaw 机器维度用量互不相通，数据来自手动上传的固定格式 CSV：
- amount-*.csv: user_id, utc_date, model, api_key_name, api_key, type, price, amount
- cost-*.csv:   user_id, utc_date, model, wallet_type, cost, currency

上传后按文件覆盖对应日期的数据，自动补充该日期的模型用量。
"""
import csv
import io
import json
import re
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.usage import (DeepseekBalance, DeepseekCost, DeepseekEntry, DeepseekImport,
                              DeepseekKeyOwner, DeepseekTopup)
from app.usage_db import get_db

router = APIRouter(prefix="/api/deepseek", tags=["Deepseek 统计"])

SH_TZ = ZoneInfo("Asia/Shanghai")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATE_COMPACT_RE = re.compile(r"^\d{8}$")
# ISO 时间戳：2026-08-01T00:00:00+08:00（浅色带时区/毫秒），取其日期部分
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$")

# amount 文件中的 type -> 聚合字段
AMOUNT_TYPES = {
    "output_tokens": "output",
    "input_cache_hit_tokens": "cache_hit",
    "input_cache_miss_tokens": "cache_miss",
    "request_count": "calls",
}


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _norm_date(value: str) -> str:
    """将日期统一为 YYYY-MM-DD：兼容 YYYY-MM-DD、无横线 YYYYMMDD 与 ISO 时间戳"""
    v = value.strip()
    if DATE_RE.match(v):
        return v
    if DATE_COMPACT_RE.match(v):
        return f"{v[:4]}-{v[4:6]}-{v[6:]}"
    if ISO_RE.match(v):
        return v[:10]
    return ""


def _parse_rows(text: str) -> tuple[str, list[dict]]:
    """按表头识别文件类型（amount / cost）并解析，返回 (kind, rows)"""
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = [f.strip().lower() for f in (reader.fieldnames or [])]
    if "amount" in fieldnames or "api_key_name" in fieldnames:
        kind = "amount"
    elif "cost" in fieldnames or "wallet_type" in fieldnames:
        kind = "cost"
    else:
        raise HTTPException(
            status_code=400,
            detail="无法识别的文件格式：表头需包含 amount/api_key_name（用量文件）或 cost/wallet_type（成本文件）",
        )

    rows = []
    for raw in reader:
        row = {k.strip().lower(): (v or "").strip() for k, v in raw.items()}
        date = _norm_date(row.get("utc_date") or row.get("date")
                          or row.get("start_time_iso") or row.get("end_time_iso"))
        model = row.get("model") or ""
        if not date or not model:
            continue
        if kind == "amount":
            try:
                price = float(row.get("price") or 0)
                amount = float(row.get("amount") or 0)
            except ValueError:
                continue
            rows.append({
                "user_id": row.get("user_id") or "",
                "date": date,
                "model": model,
                "api_key_name": row.get("api_key_name") or "",
                "api_key": row.get("api_key") or "",
                "type": row.get("type") or "",
                "price": price,
                "amount": amount,
            })
        else:
            try:
                cost = float(row.get("cost") or 0)
            except ValueError:
                continue
            rows.append({
                "user_id": row.get("user_id") or "",
                "date": date,
                "model": model,
                "wallet_type": row.get("wallet_type") or "",
                "cost": cost,
                "currency": row.get("currency") or "CNY",
            })
    if not rows:
        raise HTTPException(status_code=400, detail="文件内没有可用的数据行（需要 utc_date / model 列）")
    if kind == "amount":
        # 完全相同的行（含 price）合并数量，避免撞唯一键
        merged: dict[tuple, dict] = {}
        for r in rows:
            key = (r["date"], r["model"], r["api_key_name"], r["api_key"], r["type"], r["price"])
            if key in merged:
                merged[key]["amount"] += r["amount"]
            else:
                merged[key] = r
        rows = list(merged.values())
    return kind, rows


def _new_bucket() -> dict:
    return {"calls": 0, "output": 0, "cache_hit": 0, "cache_miss": 0, "tokens": 0}


def _load_data(db: Session, days: int | None):
    """读取日期范围内的明细与成本行"""
    start = None
    if days:
        start = (datetime.now(SH_TZ).date() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    q = db.query(DeepseekEntry)
    cq = db.query(DeepseekCost)
    if start:
        q = q.filter(DeepseekEntry.date >= start)
        cq = cq.filter(DeepseekCost.date >= start)
    return q.all(), cq.all(), start


def _aggregate(rows, cost_rows):
    """聚合：日期 / 模型 / API Key 维度 + 模型每日明细"""
    date_cost = defaultdict(float)
    model_cost = defaultdict(float)
    date_model_actual = defaultdict(float)
    for c in cost_rows:
        date_cost[c.date] += c.cost
        model_cost[c.model] += c.cost
        date_model_actual[(c.date, c.model)] += c.cost

    date_computed = defaultdict(float)
    model_computed = defaultdict(float)
    key_computed = defaultdict(float)
    date_model_computed = defaultdict(float)

    date_buckets: dict[str, dict] = {}
    model_buckets: dict[str, dict] = {}
    key_buckets: dict[str, dict] = {}
    model_daily: dict[tuple, dict] = {}

    for r in rows:
        key = AMOUNT_TYPES.get(r.type)
        if not key:
            continue
        db_ = date_buckets.setdefault(r.date, _new_bucket())
        mb = model_buckets.setdefault(r.model, _new_bucket())
        kb = key_buckets.setdefault(r.api_key_name, _new_bucket())
        kb["api_key"] = r.api_key
        md = model_daily.setdefault((r.date, r.model), _new_bucket())
        for b in (db_, mb, kb, md):
            if key == "calls":
                b["calls"] += r.amount
            else:
                b[key] += r.amount
                b["tokens"] += r.amount
        if key != "calls" and r.price:
            v = r.price * r.amount
            date_computed[r.date] += v
            model_computed[r.model] += v
            key_computed[r.api_key_name] += v
            date_model_computed[(r.date, r.model)] += v
    return {
        "date_buckets": date_buckets,
        "model_buckets": model_buckets,
        "key_buckets": key_buckets,
        "model_daily": model_daily,
        "date_cost": date_cost,
        "model_cost": model_cost,
        "date_computed": date_computed,
        "model_computed": model_computed,
        "key_computed": key_computed,
        "date_model_actual": date_model_actual,
        "date_model_computed": date_model_computed,
    }


def _bucket_cost(agg: dict, kind: str, name: str) -> float:
    if kind == "date":
        return round(agg["date_cost"].get(name, 0) or agg["date_computed"].get(name, 0), 6)
    if kind == "model":
        return round(agg["model_cost"].get(name, 0) or agg["model_computed"].get(name, 0), 6)
    return round(agg["key_computed"].get(name, 0), 6)


def _bucket_view(bucket: dict, cost: float) -> dict:
    return {
        "calls": int(bucket["calls"]),
        "input": int(bucket["cache_hit"] + bucket["cache_miss"]),
        "output": int(bucket["output"]),
        "cache_hit": int(bucket["cache_hit"]),
        "cache_miss": int(bucket["cache_miss"]),
        "tokens": int(bucket["tokens"]),
        "cost": cost,
    }


def _model_effective_cost(agg: dict, model: str) -> float:
    """模型有效成本 = 各日期（实际成本优先，缺失则用 price*amount 估算）之和"""
    total = 0.0
    for (d, m) in agg["model_daily"]:
        if m == model:
            total += agg["date_model_actual"].get((d, m), 0) or agg["date_model_computed"].get((d, m), 0)
    return round(total, 6)


@router.post("/upload")
async def upload_files(files: list[UploadFile] = File(...), db: Session = Depends(get_db)):
    """上传 amount / cost CSV（可一次多选），按日期覆盖式补充对应日期的用量"""
    results = []
    total_rows = 0
    for f in files:
        raw = await f.read()
        name = f.filename or "unknown.csv"
        if not raw:
            results.append({"filename": name, "status": "error", "message": "空文件，未解析"})
            continue
        try:
            kind, rows = _parse_rows(_decode(raw))
        except HTTPException as e:
            results.append({"filename": name, "status": "error", "message": str(e.detail)})
            continue

        dates = sorted({r["date"] for r in rows})
        try:
            if kind == "amount":
                deleted = db.query(DeepseekEntry).filter(DeepseekEntry.date.in_(dates)).delete(synchronize_session=False)
                db.bulk_insert_mappings(DeepseekEntry, rows)
            else:
                deleted = db.query(DeepseekCost).filter(DeepseekCost.date.in_(dates)).delete(synchronize_session=False)
                db.bulk_insert_mappings(DeepseekCost, rows)
            db.add(DeepseekImport(
                filename=name,
                kind=kind,
                rows=len(rows),
                date_min=dates[0],
                date_max=dates[-1],
            ))
            db.commit()
            total_rows += len(rows)
            results.append({
                "filename": name,
                "kind": kind,
                "status": "ok",
                "rows": len(rows),
                "deleted": deleted,
                "date_min": dates[0],
                "date_max": dates[-1],
            })
        except Exception as e:
            db.rollback()
            results.append({
                "filename": name,
                "kind": kind,
                "status": "error",
                "message": f"写入失败：{e}",
            })

    ok_count = sum(1 for r in results if r["status"] == "ok")
    return {
        "status": "ok" if ok_count else "error",
        "ok_count": ok_count,
        "total_rows": total_rows,
        "files": results,
    }


@router.get("/imports")
def get_imports(limit: int = 20, db: Session = Depends(get_db)):
    """最近的上传记录"""
    rows = db.query(DeepseekImport).order_by(DeepseekImport.imported_at.desc()).limit(min(limit, 100)).all()
    return {
        "items": [{
            "id": r.id,
            "filename": r.filename,
            "kind": r.kind,
            "rows": r.rows,
            "date_min": r.date_min,
            "date_max": r.date_max,
            "imported_at": r.imported_at.strftime("%Y-%m-%d %H:%M:%S") if r.imported_at else "",
        } for r in rows],
    }


@router.get("/overview")
def get_overview(days: int | None = None, db: Session = Depends(get_db)):
    """Deepseek 账号用量总览：KPI + 趋势 + 模型/API Key 排行"""
    if days is not None:
        days = min(max(days, 1), 3650)
    rows, cost_rows, start = _load_data(db, days)
    agg = _aggregate(rows, cost_rows)

    totals = _new_bucket()
    for b in agg["date_buckets"].values():
        for k in totals:
            totals[k] += b[k]

    total_cost = round(sum(_bucket_cost(agg, "date", d) for d in agg["date_buckets"]), 6)
    computed_cost = round(sum(agg["date_computed"].values()), 6)
    today = datetime.now(SH_TZ).strftime("%Y-%m-%d")
    today_bucket = agg["date_buckets"].get(today, _new_bucket())

    # 趋势：补全缺失日期
    if start:
        all_dates = [(datetime.now(SH_TZ).date() - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days - 1, -1, -1)]
    elif agg["date_buckets"]:
        min_d = min(agg["date_buckets"])
        max_d = max(agg["date_buckets"])
        cur = datetime.strptime(min_d, "%Y-%m-%d").date()
        end = datetime.strptime(max_d, "%Y-%m-%d").date()
        all_dates = []
        while cur <= end:
            all_dates.append(cur.strftime("%Y-%m-%d"))
            cur += timedelta(days=1)
    else:
        all_dates = []
    trend = []
    latest_date = ""
    latest_bucket = None
    for d in all_dates:
        b = agg["date_buckets"].get(d, _new_bucket())
        v = _bucket_view(b, _bucket_cost(agg, "date", d))
        v["date"] = d
        if b["calls"] or b["tokens"] or v["cost"]:
            latest_date = d
            latest_bucket = b
        trend.append(v)

    model_rank = [{"model": m, **_bucket_view(b, _model_effective_cost(agg, m))} for m, b in agg["model_buckets"].items()]
    model_rank.sort(key=lambda x: -x["cost"])
    key_rank = [{"api_key_name": k, "api_key": b.get("api_key", ""), **_bucket_view(b, _bucket_cost(agg, "key", k))} for k, b in agg["key_buckets"].items()]
    key_rank.sort(key=lambda x: -x["cost"])

    model_trend = [{
        "day": d,
        "model": m,
        **_bucket_view(b, 0),
        "cost": round(agg["date_model_actual"].get((d, m), 0) or agg["date_model_computed"].get((d, m), 0), 6),
    } for (d, m), b in agg["model_daily"].items()]

    # 月度汇总（用于环比/月度对比）
    monthly_map: dict[str, dict] = {}
    for t in trend:
        m = t["date"][:7]
        b = monthly_map.setdefault(m, {"month": m, "calls": 0, "tokens": 0, "cost": 0.0})
        b["calls"] += t["calls"]
        b["tokens"] += t["tokens"]
        b["cost"] += t["cost"]
    monthly = sorted(monthly_map.values(), key=lambda x: x["month"])
    for b in monthly:
        b["cost"] = round(b["cost"], 6)

    # API Key 每日趋势（按估算成本取 Top 6 Key）
    key_total_cost: dict[str, float] = {}
    for r in rows:
        if r.type != "request_count" and r.price:
            key_total_cost[r.api_key_name] = key_total_cost.get(r.api_key_name, 0) + r.price * r.amount
    top_keys = sorted(key_total_cost, key=key_total_cost.get, reverse=True)[:6]
    key_trend_map: dict[tuple, dict] = {}
    for r in rows:
        if r.api_key_name not in top_keys:
            continue
        k = AMOUNT_TYPES.get(r.type)
        if not k:
            continue
        key = (r.date, r.api_key_name)
        b = key_trend_map.setdefault(key, {"day": r.date, "api_key_name": r.api_key_name, "calls": 0, "tokens": 0, "cost": 0.0})
        if k == "calls":
            b["calls"] += r.amount
        else:
            b["tokens"] += r.amount
            if r.price:
                b["cost"] += r.price * r.amount
    api_key_trend = sorted(key_trend_map.values(), key=lambda x: (x["day"], -x["cost"]))
    for b in api_key_trend:
        b["cost"] = round(b["cost"], 6)
        b["calls"] = int(b["calls"])
        b["tokens"] = int(b["tokens"])

    imports = db.query(DeepseekImport).count()
    last_import = db.query(DeepseekImport).order_by(DeepseekImport.imported_at.desc()).first()
    min_date = min(agg["date_buckets"], default="")
    max_date = max(agg["date_buckets"], default="")

    return {
        "date_range": {"min": min_date, "max": max_date},
        "calls": int(totals["calls"]),
        "input": int(totals["cache_hit"] + totals["cache_miss"]),
        "output": int(totals["output"]),
        "cache_hit": int(totals["cache_hit"]),
        "cache_miss": int(totals["cache_miss"]),
        "tokens": int(totals["tokens"]),
        "totalCost": total_cost,
        "computedCost": computed_cost,
        "currency": "CNY",
        "today_calls": int(today_bucket["calls"]),
        "today_cost": round(_bucket_cost(agg, "date", today), 6),
        "today_tokens": int(today_bucket["tokens"]),
        "latest_date": latest_date,
        "latest_calls": int(latest_bucket["calls"]) if latest_bucket else 0,
        "latest_cost": round(_bucket_cost(agg, "date", latest_date), 6) if latest_date else 0,
        "latest_tokens": int(latest_bucket["tokens"]) if latest_bucket else 0,
        "trend": trend,
        "model_rank": model_rank,
        "api_key_rank": key_rank,
        "model_trend": model_trend,
        "monthly": monthly,
        "api_key_trend": api_key_trend,
        "imports": imports,
        "last_import": last_import.imported_at.strftime("%Y-%m-%d %H:%M:%S") if last_import else "",
        "balance": get_balance_info(db),
    }


@router.get("/screen")
def get_screen(days: int | None = None, db: Session = Depends(get_db)):
    """Deepseek 可视化大屏聚合数据"""
    return get_overview(days=days, db=db)


@router.get("/key-detail")
def get_key_detail(
    key: str,
    days: int = 30,
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
):
    """按 API Key 查看每日使用明细与汇总（token 总用量、消耗总金额）

    - key: 指定 Key 名；若为 "__all__" 或留空，则聚合全部 Key 的总计。
    - days: 近 N 天（默认 30），可与 start/end 互斥；若提供 start/end 则以起止日期为准。
    - 每日成本：金额文件里该 Key 的 price*amount 估算（成本文件无 Key 维度，无法拆分）。
    """
    key = (key or "").strip()
    all_keys = key in ("", "__all__")
    days = min(max(days, 1), 3650)

    today = datetime.now(SH_TZ).date()
    if start or end:
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date() if start else today - timedelta(days=days - 1)
            end_date = datetime.strptime(end, "%Y-%m-%d").date() if end else today
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD")
    else:
        end_date = today
        start_date = today - timedelta(days=days - 1)
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    q = db.query(DeepseekEntry).filter(
        DeepseekEntry.date >= start_str,
        DeepseekEntry.date <= end_str,
    )
    if not all_keys:
        q = q.filter(DeepseekEntry.api_key_name == key)
    rows = q.all()

    date_buckets: dict[str, dict] = {}
    date_cost: dict[str, float] = {}
    api_key = ""
    for r in rows:
        fk = AMOUNT_TYPES.get(r.type)
        if not fk:
            continue
        if not all_keys and r.api_key:
            api_key = r.api_key
        b = date_buckets.setdefault(r.date, _new_bucket())
        if fk == "calls":
            b["calls"] += r.amount
        else:
            b[fk] += r.amount
            b["tokens"] += r.amount
            if r.price:
                date_cost[r.date] = date_cost.get(r.date, 0) + r.price * r.amount

    daily = []
    totals = _new_bucket()
    total_cost = 0.0
    cur = start_date
    while cur <= end_date:
        d = cur.strftime("%Y-%m-%d")
        b = date_buckets.get(d, _new_bucket())
        cost = round(date_cost.get(d, 0), 6)
        daily.append({"date": d, **_bucket_view(b, cost)})
        for k in ("calls", "output", "cache_hit", "cache_miss", "tokens"):
            totals[k] += b[k]
        total_cost += date_cost.get(d, 0)
        cur += timedelta(days=1)

    return {
        "api_key_name": "全部 Key" if all_keys else key,
        "api_key": api_key,
        "date_range": {"start": start_str, "end": end_str},
        "daily": daily,
        "totals": {
            "calls": int(totals["calls"]),
            "input": int(totals["cache_hit"] + totals["cache_miss"]),
            "output": int(totals["output"]),
            "cache_hit": int(totals["cache_hit"]),
            "cache_miss": int(totals["cache_miss"]),
            "tokens": int(totals["tokens"]),
            "cost": round(total_cost, 6),
        },
    }


@router.get("/key-usage")
def get_key_usage(
    days: int = 30,
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
):
    """按时间区间统计各 API Key 的用量（Tokens / 金额）与占比，用于柱状图。

    - 只按时间筛选，聚合全部 Key；金额为该 Key 的 price*amount 估算（成本文件无 Key 维度）。
    - 返回按金额降序排列的各 Key 明细与区间合计，占比随响应一并给出。
    """
    days = min(max(days, 1), 3650)

    today = datetime.now(SH_TZ).date()
    if start or end:
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date() if start else today - timedelta(days=days - 1)
            end_date = datetime.strptime(end, "%Y-%m-%d").date() if end else today
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD")
    else:
        end_date = today
        start_date = today - timedelta(days=days - 1)
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    rows = db.query(DeepseekEntry).filter(
        DeepseekEntry.date >= start_str,
        DeepseekEntry.date <= end_str,
    ).all()

    key_buckets: dict[str, dict] = {}
    key_cost: dict[str, float] = {}
    for r in rows:
        fk = AMOUNT_TYPES.get(r.type)
        if not fk:
            continue
        name = r.api_key_name or "未命名 Key"
        b = key_buckets.setdefault(name, _new_bucket())
        if r.api_key:
            b["api_key"] = r.api_key
        if fk == "calls":
            b["calls"] += r.amount
        else:
            b[fk] += r.amount
            b["tokens"] += r.amount
            if r.price:
                key_cost[name] = key_cost.get(name, 0) + r.price * r.amount

    total_tokens = sum(b["tokens"] for b in key_buckets.values())
    total_cost = sum(key_cost.values())
    total_calls = sum(b["calls"] for b in key_buckets.values())

    items = []
    for name, b in key_buckets.items():
        cost = round(key_cost.get(name, 0), 6)
        view = _bucket_view(b, cost)
        view["api_key_name"] = name
        view["api_key"] = b.get("api_key", "")
        view["token_ratio"] = round(b["tokens"] / total_tokens, 6) if total_tokens else 0.0
        view["cost_ratio"] = round(cost / total_cost, 6) if total_cost else 0.0
        items.append(view)
    items.sort(key=lambda x: x["cost"], reverse=True)

    return {
        "date_range": {"start": start_str, "end": end_str},
        "totals": {
            "tokens": int(total_tokens),
            "cost": round(total_cost, 6),
            "calls": int(total_calls),
        },
        "items": items,
    }


# ===== Key 归属人员 =====

class KeyOwnerIn(BaseModel):
    api_key_name: str
    owner: str


class KeyOwnerUpdate(BaseModel):
    api_key_name: str | None = None
    owner: str | None = None


def _owner_dict(o: DeepseekKeyOwner) -> dict:
    return {
        "id": o.id,
        "api_key_name": o.api_key_name,
        "owner": o.owner,
        "created_at": o.created_at.strftime("%Y-%m-%d %H:%M:%S") if o.created_at else "",
        "updated_at": o.updated_at.strftime("%Y-%m-%d %H:%M:%S") if o.updated_at else "",
    }


@router.get("/key-owners")
def list_key_owners(db: Session = Depends(get_db)):
    """Key 归属人员列表，并附带全部已知 Key（用于前端下拉候选）"""
    rows = db.query(DeepseekKeyOwner).order_by(DeepseekKeyOwner.owner.asc(), DeepseekKeyOwner.api_key_name.asc()).all()
    known = db.query(DeepseekEntry.api_key_name).distinct().all()
    keys = sorted({(k[0] or "").strip() for k in known if (k[0] or "").strip()})
    return {"items": [_owner_dict(o) for o in rows], "keys": keys}


@router.post("/key-owners")
def create_key_owner(payload: KeyOwnerIn, db: Session = Depends(get_db)):
    """新增一条 Key 归属（同一个 Key 只能归属一名人员）"""
    key = (payload.api_key_name or "").strip()
    owner = (payload.owner or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="请填写 Key 名称")
    if not owner:
        raise HTTPException(status_code=400, detail="请填写归属人员")
    if db.query(DeepseekKeyOwner).filter(DeepseekKeyOwner.api_key_name == key).first():
        raise HTTPException(status_code=409, detail=f"{key} 已存在归属记录，请编辑或删除后再试")

    o = DeepseekKeyOwner(api_key_name=key, owner=owner)
    db.add(o)
    db.commit()
    db.refresh(o)
    return {"status": "ok", "item": _owner_dict(o)}


@router.put("/key-owners/{owner_id}")
def update_key_owner(owner_id: int, payload: KeyOwnerUpdate, db: Session = Depends(get_db)):
    """编辑某条 Key 归属（Key 或归属人员）"""
    o = db.query(DeepseekKeyOwner).filter(DeepseekKeyOwner.id == owner_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="归属记录不存在")

    if payload.api_key_name is not None:
        key = payload.api_key_name.strip()
        if not key:
            raise HTTPException(status_code=400, detail="请填写 Key 名称")
        dup = db.query(DeepseekKeyOwner).filter(
            DeepseekKeyOwner.api_key_name == key, DeepseekKeyOwner.id != owner_id
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail=f"{key} 已归属 {dup.owner}，不可重复归属")
        o.api_key_name = key
    if payload.owner is not None:
        owner = payload.owner.strip()
        if not owner:
            raise HTTPException(status_code=400, detail="请填写归属人员")
        o.owner = owner
    db.commit()
    db.refresh(o)
    return {"status": "ok", "item": _owner_dict(o)}


@router.delete("/key-owners/{owner_id}")
def delete_key_owner(owner_id: int, db: Session = Depends(get_db)):
    """删除一条 Key 归属（不可恢复）"""
    o = db.query(DeepseekKeyOwner).filter(DeepseekKeyOwner.id == owner_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="归属记录不存在")
    db.delete(o)
    db.commit()
    return {"status": "ok", "id": owner_id, "message": "归属记录已删除"}


@router.get("/owner-usage")
def get_owner_usage(
    days: int = 30,
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
):
    """按时间区间统计各归属人员（其名下全部 Key 合计）的用量与占比，用于柱状图。

    - 归属关系来自 deepseek_key_owners；未登记的 Key 归入「未归属」。
    - 金额为该人员名下 Key 的 price*amount 估算（成本文件无 Key 维度）。
    """
    days = min(max(days, 1), 3650)

    today = datetime.now(SH_TZ).date()
    if start or end:
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date() if start else today - timedelta(days=days - 1)
            end_date = datetime.strptime(end, "%Y-%m-%d").date() if end else today
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD")
    else:
        end_date = today
        start_date = today - timedelta(days=days - 1)
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    # Key -> 归属人员 映射
    key_to_owner: dict[str, str] = {}
    for o in db.query(DeepseekKeyOwner).all():
        key_to_owner[o.api_key_name] = o.owner

    rows = db.query(DeepseekEntry).filter(
        DeepseekEntry.date >= start_str,
        DeepseekEntry.date <= end_str,
    ).all()

    owner_buckets: dict[str, dict] = {}
    owner_cost: dict[str, float] = {}
    owner_keys: dict[str, set] = {}
    for r in rows:
        fk = AMOUNT_TYPES.get(r.type)
        if not fk:
            continue
        name = r.api_key_name or "未命名 Key"
        owner = key_to_owner.get(name) or "未归属"
        b = owner_buckets.setdefault(owner, _new_bucket())
        owner_keys.setdefault(owner, set()).add(name)
        if fk == "calls":
            b["calls"] += r.amount
        else:
            b[fk] += r.amount
            b["tokens"] += r.amount
            if r.price:
                owner_cost[owner] = owner_cost.get(owner, 0) + r.price * r.amount

    total_tokens = sum(b["tokens"] for b in owner_buckets.values())
    total_cost = sum(owner_cost.values())
    total_calls = sum(b["calls"] for b in owner_buckets.values())

    items = []
    for owner, b in owner_buckets.items():
        cost = round(owner_cost.get(owner, 0), 6)
        view = _bucket_view(b, cost)
        view["owner"] = owner
        view["keys"] = sorted(owner_keys.get(owner, set()))
        view["key_count"] = len(view["keys"])
        view["token_ratio"] = round(b["tokens"] / total_tokens, 6) if total_tokens else 0.0
        view["cost_ratio"] = round(cost / total_cost, 6) if total_cost else 0.0
        items.append(view)
    items.sort(key=lambda x: x["cost"], reverse=True)

    return {
        "date_range": {"start": start_str, "end": end_str},
        "totals": {
            "tokens": int(total_tokens),
            "cost": round(total_cost, 6),
            "calls": int(total_calls),
        },
        "items": items,
    }


# ===== 账户余额（官方 /user/balance，每小时轮询）=====

BALANCE_API = "https://api.deepseek.com/user/balance"
# 充值订单文本识别：兼容换行被复制打散的碎片格式（订单编号/状态/金额/支付方式/创建时间）
TOPUP_RE = re.compile(
    r"(?P<order>[A-Za-z0-9_-]{15,})"                 # 订单编号（较长字母数字串）
    r"[ \t\r\n,，;；]*?"                              # 允许跨行空白分隔
    r"(?P<status>成功|失败|处理中|已取消|已关闭|已退款|退款中|充值中|部分成功)"
    r"[ \t\r\n,，;；]*?"
    r"(?:¥|￥|RMB|CNY)?\s*(?P<amount>\d{1,3}(?:[,，]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)"  # 兼容千分位：1,000
    r"[ \t\r\n,，;；]*?"
    r"(?P<pay>支付宝|微信支付|微信|银联|银行卡|对公转账|余额|网银|云闪付|paypal|PayPal)?"
    r"[ \t\r\n,，;；]*?"
    r"(?P<time>\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}[日]?[ T]\d{1,2}:\d{2}(?::\d{2})?)"
)


def _norm_topup_time(value: str) -> str:
    """充值时间归一化为 YYYY-MM-DD HH:MM:SS"""
    v = value.strip().replace("/", "-").replace(".", "-").replace("年", "-").replace("月", "-").replace("日", "")
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$", v)
    if not m:
        return v
    date = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    time_part = f"{int(m.group(4)):02d}:{m.group(5)}" + (f":{m.group(6)}" if m.group(6) else "")
    return f"{date} {time_part}"


def _parse_topup_text(text: str) -> list[dict]:
    """从粘贴文本中自动识别充值记录行"""
    rows = []
    for m in TOPUP_RE.finditer(text):
        rec = {
            "order_id": m.group("order").strip(),
            "status": (m.group("status") or "").strip(),
            "amount": float(m.group("amount").replace(",", "").replace("，", "")),
            "pay_method": (m.group("pay") or "").strip(),
            "created_at": _norm_topup_time(m.group("time")),
        }
        if rec["order_id"] and rec["created_at"]:
            rows.append(rec)
    return rows


def _fetch_balance(api_key: str) -> dict:
    """调用 DeepSeek 官方接口获取账户余额"""
    req = urllib.request.Request(
        BALANCE_API,
        headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"余额接口返回 HTTP {e.code}（请检查 API Key 是否正确）")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"余额接口请求失败：{e}")
    try:
        payload = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=502, detail="余额接口返回非 JSON 数据")
    infos = payload.get("balance_infos") or []
    info = next((i for i in infos if i.get("currency") == "CNY"), infos[0] if infos else {})
    if not info:
        raise HTTPException(status_code=502, detail="余额接口未返回余额信息")
    return {
        "is_available": bool(payload.get("is_available")),
        "currency": info.get("currency", "CNY"),
        "total_balance": float(info.get("total_balance") or 0),
        "granted_balance": float(info.get("granted_balance") or 0),
        "topped_up_balance": float(info.get("topped_up_balance") or 0),
    }


def _read_api_key() -> str:
    from main import read_settings
    return (read_settings().get("deepseek_api_key") or "").strip()


def refresh_balance_snapshot(db: Session) -> dict | None:
    """拉取一次余额并写入快照；未配置 API Key 返回 None"""
    key = _read_api_key()
    if not key:
        return None
    data = _fetch_balance(key)
    snap = DeepseekBalance(
        currency=data["currency"],
        total_balance=data["total_balance"],
        granted_balance=data["granted_balance"],
        topped_up_balance=data["topped_up_balance"],
        is_available=data["is_available"],
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)
    return {
        "id": snap.id,
        "currency": snap.currency,
        "total_balance": snap.total_balance,
        "granted_balance": snap.granted_balance,
        "topped_up_balance": snap.topped_up_balance,
        "is_available": snap.is_available,
        "fetched_at": snap.fetched_at.strftime("%Y-%m-%d %H:%M:%S"),
    }


def _balance_daily_usage(snaps, topups) -> dict[str, dict]:
    """按天计算实际用量：日初余额 - 日末余额 + 当日成功充值（不足 0 归 0）"""
    topup_by_day = defaultdict(float)
    for t in topups:
        if t.status == "成功" and t.created_at and len(t.created_at) >= 10:
            topup_by_day[t.created_at[:10]] += t.amount
    days: dict[str, dict] = {}
    prev: float | None = None
    for s in snaps:
        day = s.fetched_at.strftime("%Y-%m-%d")
        b = days.get(day)
        if b is None:
            days[day] = {
                "date": day,
                "start": prev if prev is not None else s.total_balance,
                "end": s.total_balance,
                "topups": round(topup_by_day.get(day, 0.0), 2),
                "usage": 0.0,
            }
        else:
            b["end"] = s.total_balance
        prev = s.total_balance
    for b in days.values():
        b["usage"] = round(max(b["start"] - b["end"] + b["topups"], 0.0), 2)
        b["start"] = round(b["start"], 2)
        b["end"] = round(b["end"], 2)
    return days


def get_balance_info(db: Session) -> dict:
    """余额汇总：最新快照 + 今日实际用量 + 充值总额 + 实际总消耗"""
    latest = db.query(DeepseekBalance).order_by(DeepseekBalance.fetched_at.desc()).first()
    snaps = db.query(DeepseekBalance).order_by(DeepseekBalance.fetched_at.asc()).all()
    topups = db.query(DeepseekTopup).all()
    total_topups = round(sum(t.amount for t in topups if t.status == "成功"), 2)
    today = datetime.now(SH_TZ).strftime("%Y-%m-%d")
    today_topup = round(sum(t.amount for t in topups if t.status == "成功" and t.created_at.startswith(today)), 2)
    daily = _balance_daily_usage(snaps, topups)
    today_usage = daily.get(today, {}).get("usage", 0.0)
    initial = snaps[0].total_balance if snaps else 0.0
    current = latest.total_balance if latest else initial
    # 实际总消耗 = 累计充值 - 当前余额（充值的减去余额才是已消耗的，即目前总消耗）
    actual_usage = round(max(total_topups - current, 0.0), 2)
    daily_list = [daily[d] for d in sorted(daily)[-14:]]
    return {
        "configured": bool(_read_api_key()),
        "total_balance": latest.total_balance if latest else None,
        "granted_balance": latest.granted_balance if latest else None,
        "topped_up_balance": latest.topped_up_balance if latest else None,
        "currency": latest.currency if latest else "CNY",
        "is_available": latest.is_available if latest else None,
        "fetched_at": latest.fetched_at.strftime("%Y-%m-%d %H:%M:%S") if latest else "",
        "initial_balance": round(initial, 2),
        "total_topups": total_topups,
        "today_topup": today_topup,
        "today_usage": today_usage,
        "actual_usage": actual_usage,
        "daily_usage": daily_list,
    }


@router.get("/balance")
def get_balance(db: Session = Depends(get_db)):
    """账户余额汇总（最新快照 + 每日实际用量 + 充值统计）"""
    return get_balance_info(db)


@router.post("/balance/refresh")
def refresh_balance(db: Session = Depends(get_db)):
    """立即从官方接口拉取一次余额快照"""
    result = refresh_balance_snapshot(db)
    if result is None:
        raise HTTPException(status_code=400, detail="尚未配置 DeepSeek API Key，请先在设置页填写")
    return {"status": "ok", "balance": result}


class TopupPaste(BaseModel):
    text: str


@router.post("/topups/parse")
def parse_topups(payload: TopupPaste, db: Session = Depends(get_db)):
    """粘贴充值订单信息，自动识别并登记（按订单编号去重）"""
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="请先粘贴充值信息")
    rows = _parse_topup_text(text)
    if not rows:
        raise HTTPException(status_code=400, detail="未能识别出充值记录，请确认粘贴内容包含：订单编号/状态/金额/支付方式/创建时间")
    inserted, skipped = [], []
    for r in rows:
        exists = db.query(DeepseekTopup).filter_by(order_id=r["order_id"]).first()
        if exists:
            skipped.append(r)
            continue
        db.add(DeepseekTopup(**r))
        inserted.append(r)
    db.commit()
    return {
        "status": "ok",
        "inserted": len(inserted),
        "skipped": len(skipped),
        "items": inserted + skipped,
    }


@router.get("/topups")
def get_topups(limit: int = 50, db: Session = Depends(get_db)):
    """充值登记记录列表"""
    limit = min(max(limit, 1), 200)
    rows = db.query(DeepseekTopup).order_by(DeepseekTopup.created_at.desc(), DeepseekTopup.id.desc()).limit(limit).all()
    all_topups = db.query(DeepseekTopup).all()
    return {
        "items": [{
            "id": t.id,
            "order_id": t.order_id,
            "status": t.status,
            "amount": t.amount,
            "pay_method": t.pay_method,
            "created_at": t.created_at,
            "registered_at": t.registered_at.strftime("%Y-%m-%d %H:%M:%S") if t.registered_at else "",
        } for t in rows],
        "total": len(all_topups),
        "total_amount": round(sum(t.amount for t in all_topups if t.status == "成功"), 2),
    }
