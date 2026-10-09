"""模型健康监控中心 - 本地 API 集成测试

运行方式（项目根目录下）:
  python mhc-api/tests/test_api.py

依赖: fastapi, httpx, sqlalchemy（SQLite 兜底，无需数据库）
"""
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading

# 必须在导入 main 前设置环境：使用临时 SQLite 数据目录
TEST_DATA = tempfile.mkdtemp(prefix="mhc_test_data_")
os.environ["MHC_DATA_DIR"] = TEST_DATA
os.environ.pop("DATABASE_URL", None)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "mhc-api"))
sys.path.insert(0, PROJECT_ROOT)

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402


def make_entry(ts: int, model: str = "deepseek-v4-flash", cost: float = 0.00196, zero: bool = False, agent: str = "main"):
    if zero:
        return {
            "session_file": "C:\\fake\\agents\\main\\sessions\\s1.jsonl",
            "session_id": "s1", "agent": agent, "provider": "openclaw", "model": "gateway-injected",
            "timestamp": ts, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
            "totalTokens": 0, "totalCost": 0,
        }
    return {
        "session_file": "C:\\fake\\agents\\main\\sessions\\s1.jsonl",
        "session_id": "s1", "agent": agent, "provider": "deepseek", "model": model,
        "timestamp": ts, "input": 10000, "output": 500, "cacheRead": 2000, "cacheWrite": 0,
        "totalTokens": 12500, "totalCost": cost,
    }


def run_api_tests() -> list[str]:
    failures: list[str] = []
    import time
    today_ts = int(time.time() * 1000)

    def check(name: str, cond: bool, extra: str = ""):
        print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
        if not cond:
            failures.append(name)

    with TestClient(app) as c:
        r = c.get("/api/health")
        check("health", r.status_code == 200 and r.json()["status"] == "ok")

        r = c.get("/api/info")
        check("info", r.status_code == 200 and "模型健康监控中心" in r.json()["name"])

        r = c.get("/api/settings")
        check("settings default", r.status_code == 200 and r.json()["server"]["api_port"] == 7601)

        # 1. 推送：3 条（1 条全零应被过滤）→ 入库 2 条
        payload = {
            "machine": "vm-test-01",
            "hostname": "TESTHOST",
            "os": "Windows 11",
            "reported_at": "2026-07-31 12:00:00",
            "entries": [make_entry(today_ts), make_entry(today_ts, "deepseek-chat", 0.002, agent="ceo"), make_entry(today_ts, zero=True)],
        }
        r = c.post("/api/usage/push", json=payload)
        body = r.json()
        check("push ok", r.status_code == 200 and body["status"] == "ok")
        check("push zero filtered", body["entries_count"] == 2, str(body))
        check("push inserted", body["inserted"] == 2, str(body))

        # 2. 重复推送 → 全部去重
        r = c.post("/api/usage/push", json=payload)
        body = r.json()
        check("push dupe", body["inserted"] == 0 and body["duplicates"] == 2, str(body))

        # 3. 概览
        r = c.get("/api/usage/overview")
        ov = r.json()
        check("overview machines", ov["machines"] == 1, str(ov))
        check("overview calls", ov["calls"] == 2, str(ov))
        check("overview cost", abs(ov["totalCost"] - 0.00396) < 1e-9, str(ov["totalCost"]))
        check("overview today", ov["today_calls"] == 2 and ov["today_cost"] > 0)
        check("overview trend", len(ov["trend"]) == 7 and ov["trend"][-1]["calls"] == 2)
        check("overview top_machines", len(ov["top_machines"]) == 1 and ov["top_machines"][0]["name"] == "vm-test-01")

        # 4. 机器
        r = c.get("/api/usage/machines")
        ms = r.json()
        check("machines", ms["total"] == 1 and ms["machines"][0]["online"] is True)

        # 5. 机器详情 + 修改别名
        r = c.get("/api/usage/machines/vm-test-01")
        md = r.json()
        check("machine detail agents", len(md["agents"]) == 2, str(md["agents"]))
        r = c.put("/api/usage/machines/vm-test-01", json={"alias": "测试机A", "notes": "测试用"})
        check("machine update", r.status_code == 200)
        r = c.get("/api/usage/machines/vm-test-01")
        check("machine alias saved", r.json()["machine"]["alias"] == "测试机A")

        # 6. 汇总接口
        r = c.get("/api/usage/agents")
        check("agents", r.status_code == 200 and len(r.json()["items"]) == 2)
        r = c.get("/api/usage/models")
        check("models", r.status_code == 200 and len(r.json()["items"]) == 2)
        r = c.get("/api/usage/days?days=7")
        check("days", r.status_code == 200 and r.json()["items"][-1]["calls"] == 2)
        r = c.get("/api/usage/sessions?limit=10")
        check("sessions", r.status_code == 200 and r.json()["items"][0]["session_id"] == "s1")
        r = c.get("/api/usage/entries?limit=10")
        check("entries", r.status_code == 200 and r.json()["total"] == 2)
        r = c.get("/api/usage/pushes?limit=10")
        pushes = r.json()
        check("pushes", pushes["total"] == 2 and pushes["items"][0]["machine"] == "vm-test-01")
        check("push detail", "top_models" in pushes["items"][0]["detail"])

        # 7. 机器筛选
        r = c.get("/api/usage/models?machine=nonexistent")
        check("machine filter", r.json()["items"] == [])

        # 7.1 机器成本排行 + 按日期查看机器使用量
        today = time.strftime("%Y-%m-%d")
        r = c.get("/api/usage/machine-rank?days=7")
        mr = r.json()
        check("machine rank", r.status_code == 200 and len(mr["items"]) == 1 and mr["items"][0]["machine"] == "vm-test-01", str(mr))
        r = c.get(f"/api/usage/machine-daily?day={today}")
        md = r.json()
        check("machine daily", r.status_code == 200 and md["day"] == today and md["items"][0]["calls"] == 2, str(md))
        r = c.get("/api/usage/machine-daily?day=2000-01-01")
        check("machine daily empty", r.json()["items"] == [])

        # 7.1.1 异常机器：2 小时无推送即为异常
        # vm-test-01 有近期推送 → 正常
        # vm-abnormal-01 推送后把最近推送设为 3 小时前 → 异常
        # vm-nopush-01 全零推送只建机器不写推送记录 → 异常（从未推送）
        r = c.post("/api/usage/push", json={
            "machine": "vm-abnormal-01", "hostname": "ABN", "os": "Linux",
            "entries": [make_entry(today_ts, "deepseek-chat", 0.002, agent="ceo")],
        })
        check("abnormal setup push", r.status_code == 200 and r.json()["inserted"] == 1, str(r.status_code))
        r = c.post("/api/usage/push", json={
            "machine": "vm-nopush-01", "hostname": "NOPUSH", "os": "Linux",
            "entries": [make_entry(today_ts, zero=True)],
        })
        check("abnormal setup nopush", r.status_code == 200 and r.json()["entries_count"] == 0, str(r.json()))
        from datetime import datetime, timedelta as dt_td
        from app.usage_db import SessionLocal
        from app.models.usage import PushRecord
        with SessionLocal() as db:
            db.query(PushRecord).filter(PushRecord.machine == "vm-abnormal-01").update(
                {"received_at": datetime.now() - dt_td(hours=3)}
            )
            db.commit()
        r = c.get("/api/usage/abnormal-machines?threshold_minutes=120")
        ab = r.json()
        check("abnormal machines ok", r.status_code == 200 and ab["total_machines"] == 3, str(ab))
        names = {it["name"] for it in ab["items"]}
        check("abnormal list set", "vm-abnormal-01" in names and "vm-nopush-01" in names and "vm-test-01" not in names,
              str(names))
        check("abnormal count", ab["abnormal_count"] == len(ab["items"]) == 2, str(ab["abnormal_count"]))
        by_name = {it["name"]: it for it in ab["items"]}
        check("abnormal idle seconds", by_name["vm-abnormal-01"]["idle_seconds"] > 0, str(by_name.get("vm-abnormal-01")))
        check("abnormal never pushed", by_name["vm-nopush-01"]["idle_seconds"] is None, str(by_name.get("vm-nopush-01")))
        # 阈值放大到 3 小时 20 分：3 小时前的推送机器转为正常，只剩从未推送的机器异常
        r = c.get("/api/usage/abnormal-machines?threshold_minutes=200")
        check("abnormal threshold large", r.json()["abnormal_count"] == 1,
              str([it["name"] for it in r.json()["items"]]))
        # 清理新增机器，避免影响后续「删除后 overview 应为空」断言
        r = c.delete("/api/usage/machines/vm-abnormal-01")
        check("abnormal cleanup 1", r.status_code == 200)
        r = c.delete("/api/usage/machines/vm-nopush-01")
        check("abnormal cleanup 2", r.status_code == 200)

        # 7.2 Deepseek 上传 + 汇总（账号维度，与机器用量独立）
        amount_csv = (
            "user_id,utc_date,model,api_key_name,api_key,type,price,amount\n"
            "u1,2026-05-05,deepseek-v4-flash,keyA,sk-xxx,output_tokens,0.000002,1000\n"
            "u1,2026-05-05,deepseek-v4-flash,keyA,sk-xxx,request_count,,10\n"
            "u1,2026-05-06,deepseek-v4-pro,keyB,sk-yyy,input_cache_hit_tokens,0.00000002,500000\n"
            "u1,2026-05-06,deepseek-v4-pro,keyB,sk-yyy,request_count,,5\n"
        )
        cost_csv = (
            "user_id,utc_date,model,wallet_type,cost,currency\n"
            "u1,2026-05-05,deepseek-v4-flash,Paid,0.5,CNY\n"
            "u1,2026-05-06,deepseek-v4-pro,Paid,0.8,CNY\n"
        )
        r = c.post("/api/deepseek/upload", files=[
            ("files", ("amount-test.csv", amount_csv.encode("utf-8"), "text/csv")),
            ("files", ("cost-test.csv", cost_csv.encode("utf-8"), "text/csv")),
        ])
        body = r.json()
        check("deepseek upload", r.status_code == 200 and body["ok_count"] == 2 and body["total_rows"] == 6, str(body))
        r = c.get("/api/deepseek/overview")
        ov = r.json()
        check("deepseek overview", ov["calls"] == 15 and ov["output"] == 1000 and ov["cache_hit"] == 500000, str(ov))
        check("deepseek cost", abs(ov["totalCost"] - 1.3) < 1e-6, str(ov["totalCost"]))
        check("deepseek date range", ov["date_range"]["min"] == "2026-05-05" and ov["date_range"]["max"] == "2026-05-06", str(ov["date_range"]))
        check("deepseek model rank", len(ov["model_rank"]) == 2 and ov["model_rank"][0]["model"] == "deepseek-v4-pro", str(ov["model_rank"]))
        check("deepseek api key rank", len(ov["api_key_rank"]) == 2)
        r = c.get("/api/deepseek/imports")
        check("deepseek imports", len(r.json()["items"]) == 2)
        r = c.post("/api/deepseek/upload", files=[("files", ("amount-test.csv", amount_csv.encode("utf-8"), "text/csv"))])
        check("deepseek reupload overwrite", r.json()["files"][0]["deleted"] == 4, str(r.json()))
        r = c.get("/api/deepseek/overview")
        check("deepseek no duplicate", r.json()["calls"] == 15)
        r = c.post("/api/deepseek/upload", files=[("files", ("bad.csv", b"a,b,c\n1,2,3\n", "text/csv"))])
        check("deepseek bad file", r.status_code == 200 and r.json()["files"][0]["status"] == "error", str(r.json()))

        # 7.3 Deepseek 新版日期格式（YYYYMMDD 无横线）解析与归一化
        compact_csv = (
            "user_id,utc_date,model,api_key_name,api_key,type,price,amount\n"
            "u1,20260505,deepseek-v4-flash,keyX,sk-zzz,output_tokens,0.000002,2000\n"
            "u1,20260506,deepseek-v4-flash,keyX,sk-zzz,request_count,,8\n"
        )
        r = c.post("/api/deepseek/upload", files=[("files", ("amount-compact.csv", compact_csv.encode("utf-8"), "text/csv"))])
        check("deepseek compact upload", r.status_code == 200 and r.json()["files"][0]["rows"] == 2, str(r.json()))
        r = c.get("/api/deepseek/overview")
        ov2 = r.json()
        check("deepseek compact normalized", ov2["date_range"]["min"] == "2026-05-05" and ov2["date_range"]["max"] == "2026-05-06", str(ov2["date_range"]))
        check("deepseek compact totals", ov2["output"] == 2000 and ov2["calls"] == 8, str(ov2))

        # 7.4 实际成本 + 估算成本混合：无 cost 行的日期应使用 price*amount 估算
        mixed_csv = (
            "user_id,utc_date,model,api_key_name,api_key,type,price,amount\n"
            "u1,20260508,deepseek-v4-flash,keyM,sk-mm,output_tokens,0.000002,1000\n"
        )
        r = c.post("/api/deepseek/upload", files=[("files", ("amount-mixed.csv", mixed_csv.encode("utf-8"), "text/csv"))])
        check("deepseek mixed upload", r.status_code == 200 and r.json()["files"][0]["rows"] == 1, str(r.json()))
        r = c.get("/api/deepseek/overview")
        ov3 = r.json()
        check("deepseek mixed total cost", abs(ov3["totalCost"] - 1.302) < 1e-6, str(ov3["totalCost"]))
        hit = [t for t in ov3["model_trend"] if t["day"] == "2026-05-08" and t["model"] == "deepseek-v4-flash"]
        check("deepseek mixed model trend cost", len(hit) == 1 and abs(hit[0]["cost"] - 0.002) < 1e-9, str(hit))

        # 7.5 同 key/type 下免费（price 空）与付费两行共存（新版 6 月文件场景）
        dup_csv = (
            "user_id,utc_date,model,api_key_name,api_key,type,price,amount\n"
            "u1,20260611,deepseek-v4-flash,openclaw-it部调用,sk-zz,input_cache_hit_tokens,,102528\n"
            "u1,20260611,deepseek-v4-flash,openclaw-it部调用,sk-zz,input_cache_hit_tokens,0.00000002,80528896\n"
            "u1,20260611,deepseek-v4-flash,openclaw-it部调用,sk-zz,input_cache_miss_tokens,,14408\n"
            "u1,20260611,deepseek-v4-flash,openclaw-it部调用,sk-zz,input_cache_miss_tokens,0.000001,6664699\n"
            "u1,20260611,deepseek-v4-flash,openclaw-it部调用,sk-zz,output_tokens,,401\n"
            "u1,20260611,deepseek-v4-flash,openclaw-it部调用,sk-zz,output_tokens,0.000002,382118\n"
            "u1,20260611,deepseek-v4-flash,openclaw-it部调用,sk-zz,request_count,,911\n"
        )
        r = c.post("/api/deepseek/upload", files=[("files", ("amount-dup.csv", dup_csv.encode("utf-8"), "text/csv"))])
        body = r.json()
        check("deepseek dup upload ok", r.status_code == 200 and body["files"][0]["status"] == "ok" and body["files"][0]["rows"] == 7, str(body))
        r = c.get("/api/deepseek/overview")
        ov4 = r.json()
        hit = [t for t in ov4["trend"] if t["date"] == "2026-06-11"]
        check("deepseek dup tokens summed", len(hit) == 1 and hit[0]["cache_hit"] == 80631424 and hit[0]["output"] == 382519, str(hit))
        expect_cost = 0.00000002 * 80528896 + 0.000001 * 6664699 + 0.000002 * 382118
        check("deepseek dup cost", len(hit) == 1 and abs(hit[0]["cost"] - expect_cost) < 1e-6, str(hit[0]["cost"]))

        # 7.6 大屏增强数据：月度汇总 + API Key 每日趋势
        r = c.get("/api/deepseek/overview")
        ov5 = r.json()
        check("deepseek monthly", len(ov5["monthly"]) >= 2 and ov5["monthly"][0]["month"] == "2026-05", str(ov5.get("monthly")))
        check("deepseek monthly sum", abs(sum(m["cost"] for m in ov5["monthly"]) - ov5["totalCost"]) < 1e-6, str(ov5["monthly"]))
        check("deepseek api key trend", len(ov5["api_key_trend"]) > 0 and "day" in ov5["api_key_trend"][0], str(ov5.get("api_key_trend"))[:200])

        # 7.6.5 新版 8 月文件（start_time_iso/end_time_iso 列，无 utc_date）解析：日期取自 start_time_iso
        import app.routers.deepseek as ds_mod
        iso_amount = (
            "user_id,start_time_iso,end_time_iso,model,api_key_name,api_key,type,price,amount\n"
            "40ac24d2-b1cb-4e98-bc25-01102d9c423f,2026-08-01T00:00:00+08:00,2026-08-02T00:00:00+08:00,deepseek-v4-pro,openclaw-HZX-运营,sk-x,input_cache_hit_tokens,0.000000025,88448\n"
            "40ac24d2-b1cb-4e98-bc25-01102d9c423f,2026-08-01T00:00:00+08:00,2026-08-02T00:00:00+08:00,deepseek-v4-pro,openclaw-HZX-运营,sk-x,request_count,,3\n"
        )
        kind, rows = ds_mod._parse_rows(iso_amount)
        check("iso parse kind", kind == "amount" and len(rows) == 2, f"{kind}/{len(rows)}")
        check("iso parse date", rows[0]["date"] == "2026-08-01", str(rows[0]["date"]))
        check("iso parse model", rows[0]["model"] == "deepseek-v4-pro", str(rows[0]["model"]))
        iso_cost = (
            "user_id,start_time_iso,end_time_iso,model,wallet_type,cost,currency\n"
            "40ac24d2-b1cb-4e98-bc25-01102d9c423f,2026-08-01T00:00:00+08:00,2026-08-02T00:00:00+08:00,deepseek-v4-pro,Paid,0.0905612,CNY\n"
            "40ac24d2-b1cb-4e98-bc25-01102d9c423f,2026-08-02T00:00:00+08:00,2026-08-03T00:00:00+08:00,deepseek-v4-flash,Paid,138.97209764,CNY\n"
        )
        kind, rows = ds_mod._parse_rows(iso_cost)
        check("iso cost parse", kind == "cost" and len(rows) == 2, f"{kind}/{len(rows)}")
        check("iso cost date", rows[0]["date"] == "2026-08-01" and rows[1]["date"] == "2026-08-02", str([r["date"] for r in rows]))
        check("iso cost amount", abs(rows[0]["cost"] - 0.0905612) < 1e-9, str(rows[0]["cost"]))

        # 7.7 账户余额 + 充值登记（模拟官方 /user/balance 接口）
        # 未配置 key：余额接口提示配置；get_settings 不回显明文
        r = c.get("/api/deepseek/balance")
        check("deepseek balance unconfigured", r.json()["configured"] is False and r.json()["total_balance"] is None, str(r.json()))
        r = c.post("/api/deepseek/balance/refresh")
        check("deepseek balance refresh no key", r.status_code == 400, str(r.status_code))

        r = c.put("/api/settings", json={"deepseek_api_key": "sk-test-123"})
        check("deepseek api key saved", r.status_code == 200)
        r = c.get("/api/settings")
        body = r.json()
        check("deepseek api key hidden", "deepseek_api_key" not in body and body["deepseek_api_key_configured"] is True,
              str({k: body.get(k) for k in ("deepseek_api_key", "deepseek_api_key_configured")}))

        # 充值粘贴（模拟复制打散的碎片格式）→ 自动识别 2 条
        topup_text = (
            "订单编号\t状态\t金额\t支付方式\t创建时间\n"
            "1787627033792UkebbjnFrnFaejb\t\n"
            "成功\n"
            "¥600\t支付宝\t2026-08-25 11:03:54\n"
            "alipaywap6e8ee4c2cf28455ea635223385560555\t\n"
            "成功\n"
            "¥600\t支付宝\t2026-08-21 19:14:39\n"
        )
        r = c.post("/api/deepseek/topups/parse", json={"text": topup_text})
        body = r.json()
        check("deepseek topup parse", r.status_code == 200 and body["inserted"] == 2 and body["skipped"] == 0, str(body))
        check("deepseek topup fields", body["items"][0]["order_id"] == "1787627033792UkebbjnFrnFaejb"
              and body["items"][0]["amount"] == 600.0 and body["items"][0]["pay_method"] == "支付宝"
              and body["items"][0]["created_at"] == "2026-08-25 11:03:54", str(body["items"][0]))
        # 重复粘贴 → 全部跳过
        r = c.post("/api/deepseek/topups/parse", json={"text": topup_text})
        body = r.json()
        check("deepseek topup dupe", body["inserted"] == 0 and body["skipped"] == 2, str(body))
        # 无效文本 → 400
        r = c.post("/api/deepseek/topups/parse", json={"text": "没有任何可用数据"})
        check("deepseek topup bad text", r.status_code == 400, str(r.status_code))
        r = c.get("/api/deepseek/topups")
        tp = r.json()
        check("deepseek topups list", tp["total"] == 2 and abs(tp["total_amount"] - 1200.0) < 1e-6, str(tp))

        # 模拟余额接口返回：累计充值 1200 - 当前余额 1088 = 实际消耗 112
        import app.routers.deepseek as ds_mod
        orig_fetch = ds_mod._fetch_balance
        ds_mod._fetch_balance = lambda key: {
            "is_available": True, "currency": "CNY",
            "total_balance": 1088.0, "granted_balance": 0.0, "topped_up_balance": 1088.0,
        }
        try:
            r = c.post("/api/deepseek/balance/refresh")
            body = r.json()
            check("deepseek balance refresh", r.status_code == 200 and body["balance"]["total_balance"] == 1088.0, str(body))
            r = c.get("/api/deepseek/balance")
            bal = r.json()
            check("deepseek balance get", bal["configured"] is True and bal["total_balance"] == 1088.0
                  and abs(bal["actual_usage"] - 112.0) < 1e-6, str(bal))
            # overview 中附带余额信息（总成本卡片小字数据源）
            r = c.get("/api/deepseek/overview")
            ov6 = r.json()
            check("deepseek overview balance", "balance" in ov6 and ov6["balance"]["configured"] is True
                  and abs(ov6["balance"]["actual_usage"] - 112.0) < 1e-6, str(ov6.get("balance"))[:200])
        finally:
            ds_mod._fetch_balance = orig_fetch
        r = c.put("/api/settings", json={"deepseek_api_key": ""})
        check("deepseek api key cleared", r.status_code == 200)

        # 8. 推送令牌：保存后未带令牌应 401
        r = c.put("/api/settings", json={"push_token": "secret123"})
        check("settings token saved", r.status_code == 200)
        r = c.post("/api/usage/push", json=payload)
        check("push token required", r.status_code == 401, str(r.status_code))
        r = c.post("/api/usage/push", json=payload, headers={"X-Push-Token": "secret123"})
        check("push token ok", r.status_code == 200)
        r = c.put("/api/settings", json={"push_token": ""})
        check("settings token cleared", r.status_code == 200)

        # 9. 大屏聚合接口
        r = c.get("/api/usage/screen?days=7")
        sc = r.json()
        check("screen ok", r.status_code == 200 and sc["machines"] == 1)
        check("screen trend", len(sc["trend"]) == 7 and sc["trend"][-1]["calls"] == 2)
        check("screen model_rank", len(sc["model_rank"]) == 2)
        check("screen agent_rank", len(sc["agent_rank"]) == 2)
        check("screen machine_rank", sc["machine_rank"][0]["name"] == "vm-test-01")
        check("screen model_trend", isinstance(sc["model_trend"], list) and len(sc["model_trend"]) >= 2)
        check("screen sessions", len(sc["sessions"]) >= 1 and sc["sessions"][0]["cost"] > 0)

        # 10. 超大 tokens 回归：单次推送累计超过 21 亿（Integer 上限）不应 500
        big_payload = {
            "machine": "vm-big-tokens",
            "hostname": "BIG",
            "os": "test",
            "entries": [{
                "session_file": "C:\\fake\\agents\\main\\sessions\\big.jsonl",
                "session_id": "big",
                "agent": "main",
                "provider": "deepseek",
                "model": "deepseek-v4-flash",
                "timestamp": int(time.time() * 1000),
                "input": 3_000_000_000,
                "output": 100,
                "cacheRead": 0,
                "cacheWrite": 0,
                "totalTokens": 3_000_000_100,
                "totalCost": 0.5,
            }],
        }
        r = c.post("/api/usage/push", json=big_payload)
        check("push big tokens", r.status_code == 200 and r.json()["inserted"] == 1, str(r.status_code))
        r = c.get("/api/usage/pushes?machine=vm-big-tokens")
        check("push record big tokens", r.json()["items"][0]["total_tokens"] == 3_000_000_100, str(r.json()["items"][0]["total_tokens"]))
        r = c.delete("/api/usage/machines/vm-big-tokens")
        check("cleanup big tokens", r.status_code == 200)

        # 10. 删除机器（级联删除用量与推送）
        r = c.delete("/api/usage/machines/vm-test-01")
        body = r.json()
        check("delete machine", r.status_code == 200 and body["status"] == "ok", str(body))
        check("delete entries", body["deleted_entries"] == 2, str(body))
        check("delete pushes", body["deleted_pushes"] == 3, str(body))
        r = c.get("/api/usage/machines/vm-test-01")
        check("machine gone", r.status_code == 404)
        r = c.get("/api/usage/entries?machine=vm-test-01")
        check("entries gone", r.json()["total"] == 0)
        r = c.get("/api/usage/overview")
        check("overview empty", r.json()["machines"] == 0 and r.json()["calls"] == 0)
        r = c.delete("/api/usage/machines/vm-test-01")
        check("delete again 404", r.status_code == 404)

        # 10.5 成本趋势范围筛选：scope=all（全部）vs scope=deepseek（仅 Deepseek）
        gpt_entry = {
            "session_file": "C:\\fake\\agents\\main\\sessions\\s2.jsonl",
            "session_id": "s2", "agent": "main", "provider": "openai", "model": "gpt-4o",
            "timestamp": today_ts, "input": 100, "output": 50, "cacheRead": 0, "cacheWrite": 0,
            "totalTokens": 150, "totalCost": 0.002,
        }
        r = c.post("/api/usage/push", json={
            "machine": "vm-scope-test", "hostname": "SCOPE", "os": "Linux",
            "entries": [make_entry(today_ts, "deepseek-v4-flash", 0.001), gpt_entry],
        })
        check("scope setup push", r.json()["inserted"] == 2, str(r.json()))
        r = c.get("/api/usage/overview?days=7&scope=all")
        ov_all = r.json()
        r = c.get("/api/usage/overview?days=7&scope=deepseek")
        ov_ds = r.json()
        check("scope all calls", ov_all["calls"] == 2, str(ov_all["calls"]))
        check("scope all cost", abs(ov_all["totalCost"] - 0.003) < 1e-9, str(ov_all["totalCost"]))
        check("scope deepseek calls", ov_ds["calls"] == 1, str(ov_ds["calls"]))
        check("scope deepseek cost", abs(ov_ds["totalCost"] - 0.001) < 1e-9, str(ov_ds["totalCost"]))
        check("scope deepseek machine", ov_ds["machines"] == 1, str(ov_ds["machines"]))
        r = c.delete("/api/usage/machines/vm-scope-test")
        check("scope cleanup", r.status_code == 200)

        # 10.6 模型价格台账（人工维护，仅作台账与历史记录，不参与成本计算）
        r = c.get("/api/model-prices")
        mp = r.json()
        check("model prices empty", mp["total"] == 0, str(mp))
        price_payload = {
            "model": "deepseek-v4-flash",
            "effective_date": "2026-08-01",
            "currency": "CNY", "unit": "元/百万 tokens",
            "peak": {"cache_hit": 0.5, "cache_miss": 2.0, "output": 8.0},
            "off_peak": {"cache_hit": 0.25, "cache_miss": 1.0, "output": 4.0},
        }
        r = c.post("/api/model-prices", json=price_payload)
        body = r.json()
        check("price create", r.status_code == 200 and body["item"]["model"] == "deepseek-v4-flash", str(body))
        price_id = body["item"]["id"]
        r = c.post("/api/model-prices", json=price_payload)
        check("price create dupe", r.status_code == 409, str(r.status_code))
        # 新增第二个（更晚的）时期
        price_payload2 = dict(price_payload)
        price_payload2["effective_date"] = "2026-09-01"
        price_payload2["peak"] = {"cache_hit": 0.6, "cache_miss": 2.4, "output": 9.0}
        r = c.post("/api/model-prices", json=price_payload2)
        price_id2 = r.json()["item"]["id"]
        r = c.get("/api/model-prices")
        mp = r.json()
        check("price list grouped", mp["total"] == 1 and mp["models"][0]["model"] == "deepseek-v4-flash", str(mp))
        check("price history 2", len(mp["models"][0]["history"]) == 2, str(mp))
        # 当前生效期 = 最近启用时期（按生效日期降序 → 2026-09-01 优先）
        check("price current latest", mp["models"][0]["current"]["effective_date"] == "2026-09-01", str(mp["models"][0]["current"]))
        # 停用（取消）2026-09-01 → 当前生效期回退到 2026-08-01
        r = c.put(f"/api/model-prices/{price_id2}", json={"enabled": False})
        check("price disable", r.json()["item"]["enabled"] is False, str(r.json()["item"]["enabled"]))
        r = c.get("/api/model-prices")
        mp = r.json()
        check("price current rollback", mp["models"][0]["current"]["effective_date"] == "2026-08-01", str(mp["models"][0]["current"]))
        check("price history keeps disabled", len(mp["models"][0]["history"]) == 2, str(mp))
        # 编辑价格数值
        r = c.put(f"/api/model-prices/{price_id}", json={"peak": {"cache_hit": 0.55, "cache_miss": 2.2, "output": 8.5}})
        check("price update", abs(r.json()["item"]["peak"]["cache_hit"] - 0.55) < 1e-9, str(r.json()["item"]["peak"]))
        # 删除价格时期
        r = c.delete(f"/api/model-prices/{price_id2}")
        check("price delete", r.status_code == 200)
        r = c.get("/api/model-prices")
        check("price after delete", len(r.json()["models"][0]["history"]) == 1, str(r.json()))
        r = c.delete(f"/api/model-prices/{price_id}")
        check("price delete last", r.status_code == 200)
        r = c.get("/api/model-prices")
        check("price empty again", r.json()["total"] == 0, str(r.json()))

        # 11. 源码分发：版本 + 下载部署包
        r = c.get("/api/source/version")
        check("source version", r.status_code == 200 and r.json()["version"].count(".") == 2, str(r.json()))
        r = c.get("/api/source/download?target=tray")
        check("source download tray", r.status_code == 200 and r.headers["content-type"].startswith("application/zip"))
        import zipfile
        from io import BytesIO
        zf = zipfile.ZipFile(BytesIO(r.content))
        names = zf.namelist()
        check("tray zip has sync_tray", any(n.endswith("openclaw-sync-tray/sync_tray.ps1") for n in names), str(names[:5]))
        check("tray zip has usage script", any(n.endswith("openclaw_usage_stats.py") for n in names))
        check("tray zip has version", any(n.endswith("version.txt") for n in names))
        check("tray zip has manual", any(n.endswith("使用说明书.md") for n in names))
        r = c.get("/api/source/download?target=full")
        check("source download full", r.status_code == 200 and r.headers["content-type"].startswith("application/zip"))
        zf = zipfile.ZipFile(BytesIO(r.content))
        names = zf.namelist()
        check("full zip excludes .env", not any(n.endswith(".env") for n in names))
        check("full zip excludes node_modules", not any("node_modules" in n for n in names))
        r = c.get("/api/source/download?target=bad")
        check("source download bad target", r.status_code == 400)

    return failures


def run_script_tests() -> list[str]:
    """验证 openclaw_usage_stats.py 的 load_all / collect_entries / push_to_server"""
    import openclaw_usage_stats as u

    failures: list[str] = []

    def check(name: str, cond: bool, extra: str = ""):
        print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
        if not cond:
            failures.append(name)

    # 模拟一台虚拟机的缓存目录
    fake_root = tempfile.mkdtemp(prefix="mhc_fake_agents_")
    agent_dir = os.path.join(fake_root, "agents", "ceo", "sessions")
    os.makedirs(agent_dir, exist_ok=True)
    cache = {
        "files": {
            "C:\\fake\\agents\\ceo\\sessions\\s1.jsonl": {
                "sessionId": "s1",
                "usageEntries": [
                    {"timestamp": 1785405000000, "provider": "deepseek", "model": "deepseek-v4-flash",
                     "input": 1111, "output": 222, "cacheRead": 0, "cacheWrite": 0,
                     "totalTokens": 1333, "totalCost": 0.0003},
                    {"timestamp": 1785406000000, "provider": "openclaw", "model": "gateway-injected",
                     "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
                     "totalTokens": 0, "totalCost": 0},
                ],
            }
        }
    }
    with open(os.path.join(agent_dir, ".usage-cost-cache.json"), "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)

    # 再放一个更深层级的 cache（agents/main/sessions/2026-07/deep/...），
    # 验证 load_all 是全目录递归搜索，而不是只认 agents/*/sessions/ 这一层
    nested_dir = os.path.join(fake_root, "agents", "main", "sessions", "2026-07", "deep")
    os.makedirs(nested_dir, exist_ok=True)
    nested_cache = {
        "files": {
            "C:\\fake\\agents\\main\\sessions\\2026-07\\deep\\s2.jsonl": {
                "sessionId": "s2",
                "usageEntries": [
                    {"timestamp": 1785407000000, "provider": "deepseek", "model": "deepseek-v4-pro",
                     "input": 500, "output": 100, "cacheRead": 0, "cacheWrite": 0,
                     "totalTokens": 600, "totalCost": 0.0001},
                ],
            }
        }
    }
    with open(os.path.join(nested_dir, ".usage-cost-cache.json"), "w", encoding="utf-8") as f:
        json.dump(nested_cache, f, ensure_ascii=False)

    # 无 usage cache 的会话：用真实 .jsonl 轨迹格式（usage 嵌在 message 里，
    # 成本在 usage.cost.total），验证兜底扫描逻辑
    uncovered_dir = os.path.join(fake_root, "agents", "codex", "sessions")
    os.makedirs(uncovered_dir, exist_ok=True)
    with open(os.path.join(uncovered_dir, "u1.jsonl"), "w", encoding="utf-8") as f:
        f.write(json.dumps({"type": "session", "id": "u1", "timestamp": "2026-07-30T12:00:00.000Z"}) + "\n")
        f.write(json.dumps({
            "type": "message",
            "message": {
                "role": "assistant",
                "provider": "deepseek",
                "model": "deepseek-v4-pro",
                "usage": {
                    "input": 100, "output": 50, "cacheRead": 20, "cacheWrite": 5,
                    "totalTokens": 175,
                    "cost": {"input": 0.0001, "output": 0.0002, "cacheRead": 0.00001,
                             "cacheWrite": 0.000001, "total": 0.000311},
                },
                "timestamp": 1785407000000,
            },
        }) + "\n")
        f.write(json.dumps({"type": "message", "message": {"role": "user", "content": "hi"}}) + "\n")

    old_base = u.BASE
    u.BASE = os.path.join(fake_root, "agents")
    try:
        agent_files = u.load_all()
        check("script load_all recursive", sorted(agent_files.keys()) == ["ceo", "codex", "main"])
        check("script load_all merged", len(agent_files["main"]) == 1)
        check("script fallback scan", len(agent_files.get("codex", {})) == 1)
        entries = u.collect_entries(agent_files)
        check("script collect_entries", len(entries) == 3, str(len(entries)))
        check("script entry shape", "session_file" in entries[0] and "session_id" in entries[0])
        scanned = [e for e in entries if e["agent"] == "codex"]
        check("script fallback cost", len(scanned) == 1 and abs(scanned[0]["totalCost"] - 0.000311) < 1e-9,
              str(scanned))
    finally:
        u.BASE = old_base
        shutil.rmtree(fake_root, ignore_errors=True)

    # 验证 push_to_server 的 URL / 请求体 / 响应解析
    received: dict = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            received["path"] = self.path
            received["content_type"] = self.headers.get("Content-Type", "")
            received["body"] = json.loads(self.rfile.read(length).decode("utf-8"))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "inserted": 1}).encode("utf-8"))

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        result = u.push_to_server([{"session_file": "x"}], "vm-script-test", f"http://127.0.0.1:{port}")
        check("script push path", received["path"] == "/api/usage/push", received.get("path", ""))
        check("script push body", received["body"]["machine"] == "vm-script-test")
        check("script push response", result["status"] == "ok" and result["inserted"] == 1)
    finally:
        server.shutdown()

    return failures


if __name__ == "__main__":
    all_failures = []
    try:
        all_failures += run_api_tests()
        all_failures += run_script_tests()
    finally:
        shutil.rmtree(TEST_DATA, ignore_errors=True)
    if all_failures:
        print("\nFAILURES:", all_failures)
        sys.exit(1)
    print("\nALL TESTS PASSED")
