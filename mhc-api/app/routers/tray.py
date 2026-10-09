"""托盘远端同步指令：

网页端点「同步」按钮后，所有在线托盘会在下一个轮询周期各同步一次。
实现方式（方案A：远端指令轮询）：
  - POST /api/tray/sync/request  网页触发：全局同步纪元 +1
  - GET  /api/tray/sync/poll     托盘轮询：按机器对比已消费纪元，判断是否需要同步
  - POST /api/tray/sync/ack      托盘确认：记录该机器已消费到某纪元，避免重复触发
"""
import threading
from typing import Optional

from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session

from app.usage_db import get_db
from app.models.usage import Machine

router = APIRouter(prefix="/api/tray", tags=["托盘同步"])

# 全局同步纪元：每次网页发起同步 +1
_sync_epoch = 0
# 各机器已消费的最大纪元
_sync_acked: dict[str, int] = {}
# 各机器上报的托盘版本（用于统计在线托盘升级情况）
_machine_versions: dict[str, str] = {}
_lock = threading.Lock()


def _norm_machine(machine: str) -> str:
    """将客户端机器名归一化，保证 poll 与 ack 使用一致的 key。

    客户端通过 query 参数传递机器名时（[uri]::EscapeDataString），Uvicorn 会把
    query 字符串按 latin-1 解码，导致中文机器名变成乱码（如 "æ­£æ´40.32"）。
    这里尝试将其还原为 UTF-8；若本身已是正确 UTF-8 或纯 ASCII，则原样返回。
    """
    if not machine:
        return machine
    try:
        # latin-1 解码出来的字符串总能被 latin-1 重编码；若原本是 UTF-8 字节流则还原成功
        return machine.encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return machine


def _persist_version(db: Session, machine: str, version: str):
    """把托盘的客户端版本写入机器表，供机器列表/详情展示（只在机器已存在且版本变化时落库）"""
    if not version:
        return
    m = db.query(Machine).filter(Machine.name == machine).first()
    if not m or m.version == version:
        return
    m.version = version
    try:
        db.commit()
    except Exception:
        db.rollback()


@router.post("/sync/request")
def request_sync():
    """网页点击：广播同步指令，所有在线托盘将各同步一次"""
    global _sync_epoch
    with _lock:
        _sync_epoch += 1
        epoch = _sync_epoch
    return {"status": "ok", "epoch": epoch}


@router.get("/sync/poll")
def poll_sync(machine: str = "", version: str = "", db: Session = Depends(get_db)):
    """托盘轮询：该机器是否收到待同步指令（按已消费纪元判断）"""
    machine = _norm_machine(machine)
    if machine:
        with _lock:
            if version:
                _machine_versions[machine] = version
            if _sync_acked.get(machine, 0) < _sync_epoch:
                return {"trigger": True, "epoch": _sync_epoch}
        if version:
            _persist_version(db, machine, version)
    return {"trigger": False, "epoch": _sync_epoch}


@router.post("/sync/ack")
async def ack_sync(request: Request, machine: str = "", epoch: Optional[int] = None, version: str = "", db: Session = Depends(get_db)):
    """托盘确认已消费到该纪元，避免重复触发。

    机器名优先取 query 参数（与 poll 走同一编码路径，key 一致）；
    兼容旧版托盘用 JSON body 传递 machine/epoch（UTF-8）。
    """
    # 兼容旧版托盘的 JSON body
    if not machine or epoch is None:
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not machine:
            machine = body.get("machine", "")
        if epoch is None:
            bepoch = body.get("epoch")
            if bepoch is not None:
                epoch = int(bepoch)
    if not machine or epoch is None:
        return {"status": "error", "detail": "missing machine or epoch"}

    machine = _norm_machine(machine)
    with _lock:
        _sync_acked[machine] = max(_sync_acked.get(machine, 0), epoch)
        if version:
            _machine_versions[machine] = version
        # 简单清理，避免机器名无限累积（保留最近的 200 条）
        if len(_sync_acked) > 200:
            for k in sorted(_sync_acked, key=lambda k: _sync_acked[k])[:50]:
                _sync_acked.pop(k, None)
    if version:
        _persist_version(db, machine, version)
    return {"status": "ok"}


@router.get("/sync/status")
def sync_status():
    """查看当前同步纪元、已消费机器数及各自版本（供调试/展示用）"""
    with _lock:
        # 在线托盘 = 上报过版本（poll）或确认过同步（ack）的机器
        machines = sorted(set(_sync_acked.keys()) | set(_machine_versions.keys()))
        return {
            "epoch": _sync_epoch,
            "acked_machines": len(_sync_acked),
            "machines": machines,
            "versions": {m: _machine_versions.get(m, "") for m in machines},
        }
