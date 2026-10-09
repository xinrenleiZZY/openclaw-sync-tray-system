"""模型价格台账 API（人为维护，仅作台账与历史，不参与成本计算）

价格结构沿用 DeepSeek：高峰/空闲 × 缓存命中/缓存未命中/输出，单位：元/百万 tokens。
每个模型可有多个「时期」（以生效日期区分），每个时期可停用（取消）。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.usage import ModelPrice
from app.usage_db import get_db

router = APIRouter(prefix="/api/model-prices", tags=["模型价格"])


class PeriodPrice(BaseModel):
    cache_hit: float = 0.0
    cache_miss: float = 0.0
    output: float = 0.0


class PriceIn(BaseModel):
    model: str
    effective_date: str
    currency: str = "CNY"
    unit: str = "元/百万 tokens"
    peak: PeriodPrice
    off_peak: PeriodPrice


class PriceUpdate(BaseModel):
    model: str | None = None
    effective_date: str | None = None
    currency: str | None = None
    unit: str | None = None
    peak: PeriodPrice | None = None
    off_peak: PeriodPrice | None = None
    enabled: bool | None = None


def _to_dict(p: ModelPrice) -> dict:
    return {
        "id": p.id,
        "model": p.model,
        "effective_date": p.effective_date,
        "currency": p.currency,
        "unit": p.unit,
        "peak": {"cache_hit": p.peak_cache_hit, "cache_miss": p.peak_cache_miss, "output": p.peak_output},
        "off_peak": {"cache_hit": p.off_peak_cache_hit, "cache_miss": p.off_peak_cache_miss, "output": p.off_peak_output},
        "enabled": p.enabled,
        "created_at": p.created_at.strftime("%Y-%m-%d %H:%M:%S") if p.created_at else "",
        "updated_at": p.updated_at.strftime("%Y-%m-%d %H:%M:%S") if p.updated_at else "",
    }


@router.get("")
def list_prices(db: Session = Depends(get_db)):
    """全部模型价格，按模型分组，每个模型含历史时期列表与当前生效期"""
    rows = db.query(ModelPrice).order_by(ModelPrice.model.asc(), ModelPrice.effective_date.desc()).all()
    by_model: dict[str, list[ModelPrice]] = {}
    for r in rows:
        by_model.setdefault(r.model, []).append(r)

    models = []
    for model, items in by_model.items():
        enabled = [p for p in items if p.enabled]
        # 当前生效期 = 最近一个启用的时期（按生效日期），无启用则取最近一条
        current = enabled[0] if enabled else items[0]
        models.append({
            "model": model,
            "current": _to_dict(current),
            "history": [_to_dict(p) for p in items],
        })
    return {"models": models, "total": len(models)}


@router.post("")
def create_price(payload: PriceIn, db: Session = Depends(get_db)):
    """新增某个模型的一个价格时期"""
    model = (payload.model or "").strip()
    eff = (payload.effective_date or "").strip()
    if not model:
        raise HTTPException(status_code=400, detail="缺少模型名称")
    if not eff:
        raise HTTPException(status_code=400, detail="缺少生效日期")

    existing = db.query(ModelPrice).filter(
        ModelPrice.model == model, ModelPrice.effective_date == eff
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"{model} 在 {eff} 已存在价格时期，请编辑或更换生效日期")

    p = ModelPrice(
        model=model,
        effective_date=eff,
        currency=payload.currency,
        unit=payload.unit,
        peak_cache_hit=payload.peak.cache_hit,
        peak_cache_miss=payload.peak.cache_miss,
        peak_output=payload.peak.output,
        off_peak_cache_hit=payload.off_peak.cache_hit,
        off_peak_cache_miss=payload.off_peak.cache_miss,
        off_peak_output=payload.off_peak.output,
        enabled=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"status": "ok", "item": _to_dict(p)}


@router.put("/{price_id}")
def update_price(price_id: int, payload: PriceUpdate, db: Session = Depends(get_db)):
    """编辑某个价格时期，或启用/停用（取消）"""
    p = db.query(ModelPrice).filter(ModelPrice.id == price_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="价格时期不存在")

    if payload.model is not None and payload.model.strip():
        p.model = payload.model.strip()
    if payload.effective_date is not None and payload.effective_date.strip():
        p.effective_date = payload.effective_date.strip()
    if payload.currency is not None:
        p.currency = payload.currency
    if payload.unit is not None:
        p.unit = payload.unit
    if payload.peak is not None:
        p.peak_cache_hit = payload.peak.cache_hit
        p.peak_cache_miss = payload.peak.cache_miss
        p.peak_output = payload.peak.output
    if payload.off_peak is not None:
        p.off_peak_cache_hit = payload.off_peak.cache_hit
        p.off_peak_cache_miss = payload.off_peak.cache_miss
        p.off_peak_output = payload.off_peak.output
    if payload.enabled is not None:
        p.enabled = payload.enabled
    db.commit()
    db.refresh(p)
    return {"status": "ok", "item": _to_dict(p)}


@router.delete("/{price_id}")
def delete_price(price_id: int, db: Session = Depends(get_db)):
    """删除某个价格时期（不可恢复）"""
    p = db.query(ModelPrice).filter(ModelPrice.id == price_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="价格时期不存在")
    db.delete(p)
    db.commit()
    return {"status": "ok", "id": price_id, "message": "价格时期已删除"}
