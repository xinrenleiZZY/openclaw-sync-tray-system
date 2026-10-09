"""模型健康监控中心 - 数据库引擎（支持 PostgreSQL，SQLite 兜底）"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# 优先使用环境变量中的 DATABASE_URL，否则回退到 SQLite
DATABASE_URL = os.environ.get("DATABASE_URL", "")

if DATABASE_URL and DATABASE_URL.startswith("postgresql"):
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
else:
    DB_DIR = os.environ.get("MHC_DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))
    os.makedirs(DB_DIR, exist_ok=True)
    DB_PATH = os.path.join(DB_DIR, "usage.db")
    DATABASE_URL = f"sqlite:///{DB_PATH}"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """初始化用量统计相关表"""
    from app.models.usage import (Machine, UsageEntry, PushRecord, DeepseekEntry, DeepseekCost,
                                  DeepseekImport, DeepseekBalance, DeepseekTopup, ModelPrice,
                                  DeepseekKeyOwner)
    Base.metadata.create_all(bind=engine)
    _seed_model_prices()
    _migrate_add_columns()
    _migrate_postgres()


def _seed_model_prices():
    """首次运行时，用 settings.json 的 deepseek_pricing 种子化模型价格台账（仅当表为空时）"""
    import json
    try:
        from app.usage_db import SessionLocal
        db = SessionLocal()
        try:
            if db.query(ModelPrice).count() > 0:
                return
            data_dir = os.environ.get("MHC_DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))
            path = os.path.join(data_dir, "settings.json")
            if not os.path.exists(path):
                return
            with open(path, "r", encoding="utf-8") as f:
                settings = json.load(f)
            dp = settings.get("deepseek_pricing") or {}
            eff = dp.get("effective_date") or ""
            currency = dp.get("currency") or "CNY"
            unit = dp.get("unit") or "元/百万 tokens"
            for model, p in (dp.get("models") or {}).items():
                db.add(ModelPrice(
                    model=model,
                    effective_date=eff,
                    currency=currency,
                    unit=unit,
                    peak_cache_hit=p.get("peak", {}).get("cache_hit", 0.0),
                    peak_cache_miss=p.get("peak", {}).get("cache_miss", 0.0),
                    peak_output=p.get("peak", {}).get("output", 0.0),
                    off_peak_cache_hit=p.get("off_peak", {}).get("cache_hit", 0.0),
                    off_peak_cache_miss=p.get("off_peak", {}).get("cache_miss", 0.0),
                    off_peak_output=p.get("off_peak", {}).get("output", 0.0),
                    enabled=True,
                ))
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
    except Exception:
        pass


def _migrate_add_columns():
    """为已有数据库补齐新增列（create_all 不会给已存在的表加列，需手动 ALTER）。

    目前只缺 usage_machines.version；兼容 SQLite 与 PostgreSQL。
    """
    import sqlalchemy as sa
    targets = [("usage_machines", "version", "VARCHAR(50)")]
    try:
        with engine.connect() as conn:
            for table, col, ddl_type in targets:
                exists = False
                if engine.dialect.name == "postgresql":
                    row = conn.execute(sa.text(
                        "SELECT 1 FROM information_schema.columns "
                        "WHERE table_name=:t AND column_name=:c"
                    ), {"t": table, "c": col}).first()
                    exists = bool(row)
                    if not exists:
                        conn.execute(sa.text(f'ALTER TABLE {table} ADD COLUMN {col} {ddl_type}'))
                else:
                    rows = conn.execute(sa.text(f"PRAGMA table_info({table})")).fetchall()
                    exists = any(r[1] == col for r in rows)
                    if not exists:
                        conn.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl_type}"))
            conn.commit()
    except Exception:
        # 表不存在等场景不阻塞启动
        pass


def _migrate_postgres():
    """PostgreSQL 字段类型迁移（SQLite 动态类型无需处理）"""
    if not DATABASE_URL.startswith("postgresql"):
        return
    import sqlalchemy as sa
    try:
        with engine.connect() as conn:
            # 累计/单条 tokens 可能超过 Integer 上限（如单次推送数十亿 tokens）→ 升级为 BIGINT
            upgrades = [
                ("usage_pushes", ["total_tokens"]),
                ("usage_entries", ["input_tokens", "output_tokens", "cache_read", "cache_write", "total_tokens"]),
            ]
            for table, columns in upgrades:
                for col in columns:
                    row = conn.execute(sa.text(
                        "SELECT data_type FROM information_schema.columns "
                        "WHERE table_name=:t AND column_name=:c"
                    ), {"t": table, "c": col}).first()
                    if row and row[0] == "integer":
                        conn.execute(sa.text(f'ALTER TABLE {table} ALTER COLUMN {col} TYPE BIGINT'))
            # Deepseek 明细唯一键升级：纳入 price，允许免费/付费两条记录共存
            conn.execute(sa.text("ALTER TABLE deepseek_entries DROP CONSTRAINT IF EXISTS uq_deepseek_entry"))
            conn.execute(sa.text(
                "ALTER TABLE deepseek_entries "
                "ADD CONSTRAINT uq_deepseek_entry UNIQUE (date, model, api_key_name, api_key, type, price)"
            ))
            conn.commit()
    except Exception:
        # 迁移失败不阻塞启动（表不存在等场景）
        pass
