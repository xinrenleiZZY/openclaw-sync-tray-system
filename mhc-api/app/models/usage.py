"""模型健康监控中心 - 用量统计数据模型"""
from datetime import datetime
from sqlalchemy import Column, Integer, BigInteger, String, Text, Boolean, Float, DateTime, UniqueConstraint
from app.usage_db import Base


class Machine(Base):
    """上报机器（每台运行 OpenClaw 的虚拟机/主机）"""
    __tablename__ = "usage_machines"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)   # 机器标识（脚本 --machine）
    alias = Column(String(100), default="")                                # 显示名
    hostname = Column(String(200), default="")
    os_info = Column(String(300), default="")
    notes = Column(Text, default="")
    enabled = Column(Boolean, default=True)
    first_seen = Column(DateTime, default=datetime.now)
    last_seen = Column(DateTime, default=datetime.now)
    last_report = Column(String(40), default="")
    last_entries = Column(Integer, default=0)
    last_cost = Column(Float, default=0.0)
    version = Column(String(50), default="")                     # 客户端托盘/用量脚本版本（由托盘 poll/ack 上报，落库）
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class UsageEntry(Base):
    """单条模型调用用量记录"""
    __tablename__ = "usage_entries"
    __table_args__ = (
        UniqueConstraint("machine", "session_file", "ts", "model", name="uq_usage_entry"),
    )

    id = Column(Integer, primary_key=True, index=True)
    machine = Column(String(100), index=True, nullable=False)
    session_file = Column(String(600), default="")
    session_id = Column(String(120), default="")
    agent = Column(String(100), index=True, default="")
    provider = Column(String(120), default="")
    model = Column(String(120), index=True, default="?")
    ts = Column(DateTime, index=True, default=datetime.now)   # UTC
    day = Column(String(10), index=True, default="")          # 上海时区日期 YYYY-MM-DD
    input_tokens = Column(BigInteger, default=0)
    output_tokens = Column(BigInteger, default=0)
    cache_read = Column(BigInteger, default=0)
    cache_write = Column(BigInteger, default=0)
    total_tokens = Column(BigInteger, default=0)
    total_cost = Column(Float, default=0.0)
    received_at = Column(DateTime, default=datetime.now)


class PushRecord(Base):
    """每次推送记录"""
    __tablename__ = "usage_pushes"

    id = Column(Integer, primary_key=True, index=True)
    machine = Column(String(100), index=True)
    received_at = Column(DateTime, default=datetime.now, index=True)
    entries_count = Column(Integer, default=0)
    inserted = Column(Integer, default=0)
    duplicates = Column(Integer, default=0)
    total_cost = Column(Float, default=0.0)
    total_tokens = Column(BigInteger, default=0)   # 单次推送累计 tokens 可能超过 Integer 上限
    detail = Column(Text, default="")


class DeepseekEntry(Base):
    """Deepseek 账号维度用量明细（来源：amount-*.csv 手动上传）"""
    __tablename__ = "deepseek_entries"
    __table_args__ = (
        # price 纳入唯一键：同一 key/type 下允许“免费（price 为空）”与“付费”两条记录共存
        UniqueConstraint("date", "model", "api_key_name", "api_key", "type", "price", name="uq_deepseek_entry"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), default="", index=True)
    date = Column(String(10), index=True, nullable=False)      # UTC 日期 YYYY-MM-DD
    model = Column(String(120), index=True, nullable=False)
    api_key_name = Column(String(200), default="")
    api_key = Column(String(200), default="")
    type = Column(String(60), default="")                      # output_tokens / request_count / input_cache_hit_tokens / input_cache_miss_tokens
    price = Column(Float, default=0.0)
    amount = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.now)


class DeepseekCost(Base):
    """Deepseek 账号维度实际成本（来源：cost-*.csv 手动上传）"""
    __tablename__ = "deepseek_costs"
    __table_args__ = (
        UniqueConstraint("date", "model", "wallet_type", name="uq_deepseek_cost"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), default="", index=True)
    date = Column(String(10), index=True, nullable=False)      # UTC 日期 YYYY-MM-DD
    model = Column(String(120), index=True, nullable=False)
    wallet_type = Column(String(60), default="")
    cost = Column(Float, default=0.0)
    currency = Column(String(10), default="")
    created_at = Column(DateTime, default=datetime.now)


class DeepseekImport(Base):
    """Deepseek CSV 上传记录（历史）"""
    __tablename__ = "deepseek_imports"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(300), default="")
    kind = Column(String(20), default="")                      # amount / cost
    rows = Column(Integer, default=0)
    date_min = Column(String(10), default="")
    date_max = Column(String(10), default="")
    imported_at = Column(DateTime, default=datetime.now, index=True)


class DeepseekBalance(Base):
    """Deepseek 账户余额快照（每小时从官方 /user/balance 拉取）"""
    __tablename__ = "deepseek_balances"

    id = Column(Integer, primary_key=True, index=True)
    currency = Column(String(10), default="CNY")
    total_balance = Column(Float, default=0.0)                 # 总可用余额（含赠金）
    granted_balance = Column(Float, default=0.0)               # 未过期赠金余额
    topped_up_balance = Column(Float, default=0.0)             # 充值余额
    is_available = Column(Boolean, default=True)               # 是否还有余额可供调用
    fetched_at = Column(DateTime, default=datetime.now, index=True)


class DeepseekTopup(Base):
    """Deepseek 充值记录（粘贴订单信息自动登记）"""
    __tablename__ = "deepseek_topups"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(200), unique=True, index=True, nullable=False)
    status = Column(String(50), default="")                    # 成功 / 失败 / 处理中 ...
    amount = Column(Float, default=0.0)
    pay_method = Column(String(50), default="")                # 支付宝 / 微信 / 银联 ...
    created_at = Column(String(30), default="")                # "2026-08-25 11:03:54"
    registered_at = Column(DateTime, default=datetime.now)


class ModelPrice(Base):
    """模型价格台账（人为维护，仅作台账与历史记录，不参与成本计算）

    沿用 DeepSeek 价格结构：高峰 / 空闲 × 缓存命中 / 缓存未命中 / 输出。
    每个模型可有多个「时期」（以生效日期区分），每个时期可停用（取消）。
    格式与 settings.json 中 deepseek_pricing.models 保持对应，便于初始种子。
    """
    __tablename__ = "model_prices"
    __table_args__ = (
        UniqueConstraint("model", "effective_date", name="uq_model_price_period"),
    )

    id = Column(Integer, primary_key=True, index=True)
    model = Column(String(120), index=True, nullable=False)
    effective_date = Column(String(10), index=True, nullable=False)   # 该价格时期生效日期 YYYY-MM-DD
    currency = Column(String(10), default="CNY")
    unit = Column(String(30), default="元/百万 tokens")
    peak_cache_hit = Column(Float, default=0.0)
    peak_cache_miss = Column(Float, default=0.0)
    peak_output = Column(Float, default=0.0)
    off_peak_cache_hit = Column(Float, default=0.0)
    off_peak_cache_miss = Column(Float, default=0.0)
    off_peak_output = Column(Float, default=0.0)
    enabled = Column(Boolean, default=True)                          # 是否启用（取消=停用该时期）
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class DeepseekKeyOwner(Base):
    """Deepseek API Key 归属人员（一个 Key 只能归属一名人员，一名人员可归属多个 Key）"""
    __tablename__ = "deepseek_key_owners"

    id = Column(Integer, primary_key=True, index=True)
    api_key_name = Column(String(200), unique=True, index=True, nullable=False)   # Key 名称（唯一）
    owner = Column(String(100), index=True, nullable=False)                       # 归属人员
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
