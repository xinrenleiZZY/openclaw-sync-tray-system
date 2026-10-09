#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenClaw API 用量统计脚本
=========================
统计 OpenClaw 网关下所有 agent/会话 使用 DeepSeek token 的真实用量与成本。

数据来源（非实时 API，是网关本地累计缓存）:
  C:\\Users\\Administrator\\.openclaw\\agents\\**\\.usage-cost-cache.json
  递归搜索整个 agents 目录，不限定固定层级：cache 文件可以出现在
  <agent>\\sessions\\ 下，也可以出现在任意更深/更浅的子目录中；
  agent 名取 cache 文件相对 agents 目录的第一层目录名。
  该文件由 OpenClaw 网关自动扫描各会话 .jsonl 轨迹文件后写入，
  含每次模型调用的 input/output/cacheRead/cacheWrite/totalCost 等字段。
  对于还没有生成 usage cache 的会话，脚本会直接扫描原始 .jsonl 轨迹文件，
  提取 usage 字段（兼容 input_tokens/cache_read_input_tokens 等蛇形命名）作为兜底。

成本计价（与 openclaw.json 中 DeepSeek 定价一致）:
  input: $0.14 / 1M tokens
  output: $0.28 / 1M tokens
  cacheRead: $0.028 / 1M tokens
  cacheWrite: $1 / 1M tokens

用法:
  python usage_stats.py                 # 全部统计（按agent/模型/日期）
  python usage_stats.py --days 7        # 只看最近7天
  python usage_stats.py --agent ceo     # 只看指定agent
  python usage_stats.py --json          # JSON输出
  python usage_stats.py --top-sessions  # 按会话明细排序
  python usage_stats.py --push --server http://192.168.0.193:7601 --machine vm-01
                                        # 推送用量到模型健康监控中心（局域网）
"""

import argparse
import datetime
import glob
import io
import json
import os
import platform
import socket
import sys
import urllib.request
import urllib.error

BASE = r"C:\Users\Administrator\.openclaw\agents"


def parse_timestamp(value):
    """把时间戳转成毫秒：数字直接按 ms/s 判断，ISO 字符串解析"""
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        v = float(value)
        return int(v if v > 1e11 else v * 1000)
    s = str(value).strip()
    if not s:
        return 0
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return int(datetime.datetime.fromisoformat(s).timestamp() * 1000)
    except ValueError:
        return 0


def read_text_tolerant(fp):
    """读取会话文件文本，容忍非 UTF-8 编码（如 GBK 写入的 .jsonl），避免单个坏文件让整轮扫描崩溃。

    解码顺序：UTF-8(BOM) → GB18030 → UTF-8 替换非法字节兜底。
    """
    with open(fp, "rb") as fh:
        raw = fh.read()
    for enc in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def scan_session_file(fp):
    """直接从 .jsonl 会话轨迹文件提取 usage entries（无 usage cache 时的兜底）"""
    entries = []
    try:
        with io.StringIO(read_text_tolerant(fp)) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(rec, dict):
                    continue
                message = rec.get("message") if isinstance(rec.get("message"), dict) else {}
                # usage 可能出现在顶层，也可能嵌在 message 里（真实格式）
                usage = rec.get("usage") if isinstance(rec.get("usage"), dict) else None
                if not isinstance(usage, dict):
                    usage = message.get("usage") if isinstance(message.get("usage"), dict) else None
                if not isinstance(usage, dict):
                    continue  # 非模型调用记录（user/system/model_change 等）

                def num(*keys):
                    for k in keys:
                        v = usage.get(k, message.get(k))
                        if v is not None:
                            try:
                                return int(v)
                            except (TypeError, ValueError):
                                return 0
                    return 0

                e = {
                    # 真实格式里 message.timestamp 是毫秒，行级 timestamp 是 ISO 字符串
                    "timestamp": parse_timestamp(message.get("timestamp", rec.get("timestamp"))),
                    "provider": rec.get("provider") or message.get("provider") or "",
                    "model": rec.get("model") or message.get("model") or rec.get("modelName") or "?",
                    "input": num("input", "input_tokens", "prompt_tokens"),
                    "output": num("output", "output_tokens", "completion_tokens"),
                    "cacheRead": num("cacheRead", "cache_read_input_tokens"),
                    "cacheWrite": num("cacheWrite", "cache_creation_input_tokens"),
                }
                e["totalTokens"] = e["input"] + e["output"] + e["cacheRead"] + e["cacheWrite"]
                # 真实格式成本在 usage.cost.total，也兼容 costUSD / totalCost
                cost = usage.get("cost")
                if isinstance(cost, dict):
                    cost = cost.get("total")
                if cost is None:
                    cost = rec.get("costUSD", rec.get("totalCost"))
                if cost is None:
                    cost = usage.get("totalCost", usage.get("costUSD", 0))
                if cost is None:
                    cost = 0
                try:
                    e["totalCost"] = round(float(cost), 8)
                except (TypeError, ValueError):
                    e["totalCost"] = 0
                # 与网关一致：model 形如 provider/model 时拆开
                if not e["provider"] and "/" in e["model"]:
                    e["provider"], e["model"] = e["model"].split("/", 1)
                entries.append(e)
    except OSError as exc:
        print(f"[warn] 扫描会话文件 {fp} 失败: {exc}", file=sys.stderr)
    return entries


def session_id_from_file(fp):
    """从会话文件名提取 UUID（兼容 xxx.jsonl 与 xxx.jsonl.reset.<时间> 归档名）"""
    name = os.path.basename(fp)
    idx = name.find(".jsonl")
    if idx > 0:
        return name[:idx]
    return os.path.splitext(name)[0]


def _load_all_impl():
    """读取所有 agent 的 usage cache，返回 {agent: {file: meta}} 和兜底扫描的文件数"""
    result = {}
    scanned_count = 0
    pattern = os.path.join(BASE, "**", ".usage-cost-cache.json")
    for cache_file in glob.glob(pattern, recursive=True):
        # agent 名 = cache 文件相对 agents 的第一层目录（任意嵌套深度都能正确归位）
        rel_dir = os.path.relpath(os.path.dirname(cache_file), BASE)
        parts = [p for p in rel_dir.split(os.sep) if p not in ("", ".")]
        agent = parts[0] if parts else os.path.basename(BASE)
        try:
            with open(cache_file, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            # 同一 agent 可能散落多个 cache 文件，按会话文件路径合并
            result.setdefault(agent, {}).update(data.get("files", {}))
        except Exception as e:
            print(f"[warn] 读取 {cache_file} 失败: {e}", file=sys.stderr)

    # 已由 cache 覆盖的会话文件（按路径、并按同名文件双保险去重）
    covered = set()
    covered_names = {}
    for files in result.values():
        for fp in files:
            covered.add(os.path.normcase(os.path.normpath(fp)))
            covered_names.setdefault(os.path.normcase(os.path.basename(fp)), True)

    # 兜底：递归扫描所有 .jsonl 会话轨迹文件（含 .jsonl.reset.xxx 归档文件）
    for pat in (os.path.join(BASE, "**", "*.jsonl"), os.path.join(BASE, "**", "*.jsonl.*")):
        for fp in glob.glob(pat, recursive=True):
            if os.path.normcase(os.path.normpath(fp)) in covered:
                continue
            if os.path.normcase(os.path.basename(fp)) in covered_names:
                continue
            entries = scan_session_file(fp)
            if not entries:
                continue
            rel_dir = os.path.relpath(os.path.dirname(fp), BASE)
            parts = [p for p in rel_dir.split(os.sep) if p not in ("", ".")]
            agent = parts[0] if parts else os.path.basename(BASE)
            result.setdefault(agent, {})[fp] = {
                "sessionId": session_id_from_file(fp),
                "usageEntries": entries,
            }
            covered.add(os.path.normcase(os.path.normpath(fp)))
            covered_names[os.path.normcase(os.path.basename(fp))] = True
            scanned_count += 1
    return result, scanned_count


def load_all():
    """读取所有 agent 的 usage cache（含无缓存时的 .jsonl 兜底扫描）"""
    return _load_all_impl()[0]


def load_all_with_stats():
    """同 load_all，附带返回直接扫描（无缓存）的会话文件数"""
    return _load_all_impl()


def aggregate(agent_files, days=None, agent_filter=None, model_filter=None):
    """聚合统计"""
    stats = {
        "agents": {},       # agent -> totals
        "models": {},       # model -> totals
        "days": {},         # date -> totals
        "sessions": {},     # session file -> totals
        "totals": {"calls": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "cost": 0.0},
    }

    now = datetime.datetime.utcnow()
    cutoff = None
    if days:
        cutoff = now - datetime.timedelta(days=days)

    def add(target, key, e):
        t = target.setdefault(key, {"calls": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "cost": 0.0})
        t["calls"] += 1
        t["input"] += e.get("input", 0) or 0
        t["output"] += e.get("output", 0) or 0
        t["cacheRead"] += e.get("cacheRead", 0) or 0
        t["cacheWrite"] += e.get("cacheWrite", 0) or 0
        t["cost"] += e.get("totalCost", 0) or 0

    for agent, files in agent_files.items():
        if agent_filter and agent != agent_filter:
            continue
        for fp, meta in files.items():
            for e in meta.get("usageEntries", []):
                ts = e.get("timestamp", 0) / 1000
                dt = datetime.datetime.utcfromtimestamp(ts)
                if cutoff and dt < cutoff:
                    continue
                model = e.get("model", "?")
                if model_filter and model != model_filter:
                    continue
                add(stats["agents"], agent, e)
                add(stats["models"], model, e)
                add(stats["days"], dt.strftime("%Y-%m-%d"), e)
                add(stats["sessions"], fp, e)
                add(stats["totals"], "__total__", e)
    return stats


def collect_entries(agent_files, skip_zero=True):
    """收集所有原始 usage entries（用于推送到监控中心）"""
    entries = []
    for agent, files in agent_files.items():
        for fp, meta in files.items():
            session_id = meta.get("sessionId", "")
            for e in meta.get("usageEntries", []):
                input_t = e.get("input", 0) or 0
                output_t = e.get("output", 0) or 0
                cache_r = e.get("cacheRead", 0) or 0
                cache_w = e.get("cacheWrite", 0) or 0
                cost = e.get("totalCost", 0) or 0
                if skip_zero and not (input_t or output_t or cache_r or cache_w or cost):
                    continue
                entries.append({
                    "session_file": fp,
                    "session_id": session_id,
                    "agent": agent,
                    "provider": e.get("provider", ""),
                    "model": e.get("model", "?"),
                    "timestamp": e.get("timestamp", 0),
                    "input": input_t,
                    "output": output_t,
                    "cacheRead": cache_r,
                    "cacheWrite": cache_w,
                    "totalTokens": e.get("totalTokens", 0) or 0,
                    "totalCost": cost,
                })
    return entries


def push_to_server(entries, machine, server, hostname="", os_name=""):
    """通过局域网将用量推送到模型健康监控中心 /api/usage/push"""
    payload = {
        "machine": machine,
        "hostname": hostname or socket.gethostname(),
        "os": os_name or f"{platform.system()} {platform.release()}",
        "reported_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "entries": entries,
    }
    url = server.rstrip("/") + "/api/usage/push"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"服务器返回 {e.code}: {body[:500]}")
    except Exception as e:
        raise RuntimeError(f"推送失败: {e}")


def fmt_num(n):
    if n >= 1e9:
        return f"{n/1e9:.2f}B"
    if n >= 1e6:
        return f"{n/1e6:.2f}M"
    if n >= 1e3:
        return f"{n/1e3:.1f}K"
    return str(int(n))


def print_table(title, data, show_cache=True):
    print(f"\n=== {title} ===")
    if not data:
        print("  (无数据)")
        return
    header = f"{'名称':<28}{'调用':>8}{'输入':>12}{'输出':>10}{'缓存读':>12}{'成本$':>12}"
    print(header)
    print("-" * len(header))
    for k, v in sorted(data.items(), key=lambda x: -x[1]["cost"]):
        print(f"{k:<28}{v['calls']:>8}{fmt_num(v['input']):>12}{fmt_num(v['output']):>10}{fmt_num(v['cacheRead']):>12}{v['cost']:>12.4f}")


def default_server() -> str | None:
    """监控中心地址默认值：优先取环境变量 MHC_HOST + MHC_API_PORT"""
    host = os.environ.get("MHC_HOST")
    if not host:
        return None
    return f"http://{host}:{os.environ.get('MHC_API_PORT', '7601')}"


def main():
    ap = argparse.ArgumentParser(description="OpenClaw API 用量统计")
    ap.add_argument("--days", type=int, default=None, help="只统计最近N天")
    ap.add_argument("--agent", default=None, help="只统计指定agent")
    ap.add_argument("--model", default=None, help="只统计指定模型")
    ap.add_argument("--json", action="store_true", help="JSON输出")
    ap.add_argument("--top-sessions", action="store_true", help="按会话明细输出")
    ap.add_argument("--server", default=default_server(), help="监控中心地址（默认取 MHC_HOST 环境变量），如 http://192.168.0.193:7601")
    ap.add_argument("--push", action="store_true", help="推送用量到监控中心（需配合 --server）")
    ap.add_argument("--machine", default=None, help="机器标识（默认取主机名）")
    args = ap.parse_args()

    agent_files, scanned_count = load_all_with_stats()
    stats = aggregate(agent_files, days=args.days, agent_filter=args.agent, model_filter=args.model)

    if args.push:
        if not args.server:
            print("错误: --push 需要 --server 参数（如 --server http://192.168.0.193:7601）", file=sys.stderr)
            sys.exit(2)
        entries = collect_entries(agent_files)
        machine = args.machine or socket.gethostname()
        print(f"收集到 {len(entries)} 条用量记录，推送至 {args.server} (machine={machine}) ...")
        try:
            result = push_to_server(entries, machine, args.server)
        except RuntimeError as e:
            print(f"[error] {e}", file=sys.stderr)
            sys.exit(1)
        print("推送完成:")
        print(f"  机器: {result.get('machine')}")
        print(f"  条目: {result.get('entries_count')} (新增 {result.get('inserted')} / 重复 {result.get('duplicates')})")
        print(f"  成本: ${result.get('total_cost', 0):.4f} (≈RMB {result.get('total_cost', 0) * 7.2:.2f})")
        return

    if args.json:
        print(json.dumps(stats, ensure_ascii=False, indent=2, default=str))
        return

    t = stats["totals"].get("__total__", {"calls": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "cost": 0.0})
    print("=" * 60)
    print(f"OpenClaw API 用量统计  (数据截止: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')})")
    print(f"统计范围: {'最近%d天' % args.days if args.days else '全部历史'} | agent={args.agent or '全部'} | 模型={args.model or '全部'}")
    if scanned_count:
        print(f"（其中 {scanned_count} 个会话没有 usage cache，已直接扫描 .jsonl 轨迹文件）")
    print("=" * 60)
    print(f"总调用次数: {t['calls']}")
    print(f"输入 tokens: {fmt_num(t['input'])}")
    print(f"输出 tokens: {fmt_num(t['output'])}")
    print(f"缓存读取: {fmt_num(t['cacheRead'])}")
    print(f"缓存写入: {fmt_num(t['cacheWrite'])}")
    print(f"总成本: ${t['cost']:.4f} (≈RMB {t['cost']*7.2:.2f})")

    print_table("按 Agent", stats["agents"])
    print_table("按 模型", stats["models"])
    print_table("按 日期", stats["days"])

    if args.top_sessions:
        print_table("按 会话 (Top)", dict(sorted(stats["sessions"].items(), key=lambda x: -x[1]["cost"])[:20]))


if __name__ == "__main__":
    main()
