"""飞书「openclaw登记」电子表格只读接入模块

用途：
  机器列表/详情弹窗的 machine_info 数据源。读取飞书 Wiki 节点下的电子表格
  「openclaw登记」，解析出部门/机器人名称/IP/用户名/API Key/账号/密码等字段，
  按机器 hostname / IP 匹配填充到机器信息弹窗。

安全：
  密码与 API Key 默认脱敏展示（保留前 2 后 2，中间以 * 填充）。

配置（环境变量）：
  FEISHU_APP_ID      飞书开放平台应用 App ID
  FEISHU_APP_SECRET  飞书开放平台应用 App Secret
  FEISHU_WIKI_TOKEN  Wiki 节点 token（必填，见项目根目录 .env）
  FEISHU_SHEET_REGISTER  目标工作表名（默认 openclaw登记）
"""
import os
import time
from datetime import datetime

import requests

BASE_URL = "https://open.feishu.cn/open-apis"

# 环境变量默认值
WIKI_TOKEN = os.getenv("FEISHU_WIKI_TOKEN", "")
SHEET_NAME = os.getenv("FEISHU_SHEET_REGISTER", "openclaw登记")

# 缓存（token / 表格数据），避免每次请求都调飞书
_TOKEN_CACHE: dict = {"token": None, "expire_at": 0}
_SHEET_CACHE: dict = {"rows": None, "fetched_at": 0}
_CACHE_TTL = 600  # 表格数据缓存 10 分钟


class FeishuSheetError(Exception):
    """飞书电子表格读取异常"""


def _get_token() -> str:
    """获取 tenant_access_token（带缓存）"""
    now = time.time()
    if _TOKEN_CACHE["token"] and now < _TOKEN_CACHE["expire_at"] - 60:
        return _TOKEN_CACHE["token"]
    app_id = (os.getenv("FEISHU_APP_ID", "") or "").strip()
    app_secret = (os.getenv("FEISHU_APP_SECRET", "") or "").strip()
    if not app_id or not app_secret:
        raise FeishuSheetError("未配置 FEISHU_APP_ID / FEISHU_APP_SECRET")
    resp = requests.post(
        f"{BASE_URL}/auth/v3/tenant_access_token/internal",
        headers={"Content-Type": "application/json; charset=utf-8"},
        json={"app_id": app_id, "app_secret": app_secret},
        timeout=10,
    )
    data = resp.json()
    if data.get("code") != 0:
        raise FeishuSheetError(f"飞书认证失败: {data.get('msg', '')} code={data.get('code')}")
    _TOKEN_CACHE["token"] = data["tenant_access_token"]
    _TOKEN_CACHE["expire_at"] = now + data.get("expire", 7200)
    return _TOKEN_CACHE["token"]


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_get_token()}",
        "Content-Type": "application/json; charset=utf-8",
    }


def _resolve_sheet_token() -> str:
    """通过 Wiki 节点 token 解析出电子表格 obj_token"""
    data = requests.get(
        f"{BASE_URL}/wiki/v2/spaces/get_node",
        params={"token": WIKI_TOKEN},
        headers=_headers(),
        timeout=10,
    ).json()
    if data.get("code") != 0:
        raise FeishuSheetError(f"Wiki 节点解析失败: {data.get('msg', '')} code={data.get('code')}")
    node = data.get("data", {}).get("node", {})
    if node.get("obj_type") != "sheet" and node.get("obj_type") != "bitable":
        raise FeishuSheetError(f"Wiki 节点类型不是表格: {node.get('obj_type')}")
    return node["obj_token"]


def _sheet_meta(spreadsheet_token: str) -> dict:
    """获取电子表格元信息（子表列表）"""
    resp = requests.get(
        f"{BASE_URL}/sheets/v2/spreadsheets/{spreadsheet_token}/metainfo",
        headers=_headers(),
        timeout=10,
    )
    data = resp.json()
    if data.get("code") != 0:
        raise FeishuSheetError(f"读取表格元信息失败: {data.get('msg', '')} code={data.get('code')}")
    return data.get("data", {})


def _all_records() -> list[dict]:
    """读取「openclaw登记」工作表全部数据，返回以表头为 key 的字典列表（带缓存）。"""
    now = time.time()
    if _SHEET_CACHE["rows"] is not None and (now - _SHEET_CACHE["fetched_at"]) < _CACHE_TTL:
        return _SHEET_CACHE["rows"]

    token = _resolve_sheet_token()
    meta = _sheet_meta(token)
    target = next(
        (sh for sh in meta.get("sheets", []) if sh.get("title") == SHEET_NAME),
        meta.get("sheets", [{}])[0],
    )
    if not target:
        raise FeishuSheetError(f"未找到工作表 '{SHEET_NAME}'")
    sheet_id = target["sheetId"]
    row_count = target.get("rowCount", 200)
    col_count = target.get("columnCount", 24)
    end_col = chr(min(col_count - 1, 25) + 65) if col_count and col_count <= 26 else "Z"
    range_str = f"{sheet_id}!A1:{end_col}{min(row_count, 1000)}"

    resp = requests.get(
        f"{BASE_URL}/sheets/v2/spreadsheets/{token}/values/{range_str}",
        headers=_headers(),
        timeout=15,
    )
    data = resp.json()
    if data.get("code") != 0:
        raise FeishuSheetError(f"读取表格内容失败: {data.get('msg', '')} code={data.get('code')}")
    values = data.get("data", {}).get("valueRange", {}).get("values", [])

    if not values:
        _SHEET_CACHE["rows"] = []
        _SHEET_CACHE["fetched_at"] = now
        return []

    header = [str(h).strip() for h in values[0] if h is not None]
    rows = []
    for raw in values[1:]:
        if not any(c for c in raw if c is not None):
            continue
        record = {}
        for i, key in enumerate(header):
            if not key:
                continue
            v = raw[i] if i < len(raw) else None
            record[key] = "" if v is None else str(v).strip()
        rows.append(record)

    _SHEET_CACHE["rows"] = rows
    _SHEET_CACHE["fetched_at"] = now
    return rows


def _mask(value: str, keep: int = 2) -> str:
    """脱敏：保留前 keep 后 keep，中间以 * 填充。

    若值本身已含 '*'（如表里 API Key 缩写已是 sk-xxx***xxx 形式），直接返回。
    """
    value = (value or "").strip()
    if not value:
        return value
    if "*" in value:
        return value
    if len(value) <= keep * 2:
        return value[0] + "*" * (len(value) - 1)
    return value[:keep] + "*" * (len(value) - keep * 2) + value[-keep:]


# 字段映射：飞书表头 -> machine_info 键
# 注意：多个表头可能映射到同一 machine_info 键（如 ip 有 "ip地址"/"ip" 两种写法），
# 映射时只取第一个非空值，避免后续空值覆盖。
_FIELD_MAP = {
    "部门": "department",
    "机器人名称": "robot_name",
    "ip地址": "ip",
    "ip": "ip",
    "用户名": "username",
    "API Key名称": "api_key1_name",
    "API Key缩写": "api_key1_short",
    "API Key2名称": "api_key2_name",
    "API Key2缩写": "api_key2_short",
    "账号": "account",
    "密码": "password",
}


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _match_score(record: dict, hostname: str, name: str, alias: str) -> int:
    """返回记录对某台机器的匹配得分，0 表示不匹配；得分越高越精确。"""
    host = _norm(hostname)
    name_l = _norm(name)
    alias_l = _norm(alias)
    if not host and not name_l:
        return 0

    username = _norm(record.get("用户名", ""))
    ip = _norm(record.get("ip地址", "") or record.get("ip", ""))
    robot = _norm(record.get("机器人名称", ""))
    department = _norm(record.get("部门", ""))

    score = 0
    # 1) hostname 与用户名子串匹配（最可靠）
    if host and username:
        if host in username or username in host:
            score += 100
    # 2) hostname 与 IP 匹配
    if host and ip:
        if host in ip or ip in host:
            score += 80
    # 3) 机器名/别名 包含机器人名称 或 部门+机器人
    if robot and (robot in name_l or robot in alias_l):
        score += 40
    if robot and department and (department + robot) in name_l:
        score += 50
    # 4) IP 出现在机器名/别名中（如 "采购部虾皮157" 含 IP 末段 157）
    if ip:
        ip_tail = ip.split(".")[-1]
        if ip_tail and (ip_tail in name_l or ip_tail in alias_l):
            score += 30
    # 5) 用户名末段出现在机器名中（如 HZX-LX-002cg -> 002cg）
    if username:
        user_tail = username.split("-")[-1]
        if user_tail and user_tail in name_l:
            score += 20
    return score


def get_machine_info_for(hostname: str = "", name: str = "", alias: str = "") -> dict:
    """按 hostname / 机器名 / 别名 匹配飞书「openclaw登记」记录，返回 machine_info。

    匹配不到时返回空结构（弹窗显示 '-'）。
    """
    empty = {
        "department": "", "robot_name": "", "ip": "", "username": "",
        "api_key1_name": "", "api_key1_short": "",
        "api_key2_name": "", "api_key2_short": "",
        "account": "", "password": "",
    }
    try:
        rows = _all_records()
    except Exception:
        return empty
    if not rows:
        return empty

    best_record = None
    best_score = 0
    for rec in rows:
        s = _match_score(rec, hostname, name, alias)
        if s > best_score:
            best_score = s
            best_record = rec

    if not best_record or best_score == 0:
        return empty

    # 只取映射到的字段，其余留空；同键多表头时取第一个非空值
    info = dict(empty)
    for feishu_key, target_key in _FIELD_MAP.items():
        if info.get(target_key):
            continue
        val = best_record.get(feishu_key, "") or ""
        if target_key in ("password", "api_key1_short", "api_key2_short"):
            val = _mask(val)
        info[target_key] = val or ""
    return info
