"use client";

import { useEffect, useState, useCallback } from "react";
import { clientFetch } from "@/lib/api";
import { fmtTokens, fmtCost, shortPath } from "@/lib/format";
import type { SessionStat } from "@/lib/api";

export default function SessionsClient() {
  const [items, setItems] = useState<SessionStat[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [machine, setMachine] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (m) params.set("machine", m);
      params.set("limit", "50");
      const data = await clientFetch<{ items: SessionStat[] }>(`/api/usage/sessions?${params.toString()}`);
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clientFetch<{ machines: { name: string }[] }>("/api/usage/machines")
      .then((d) => setMachines(d.machines.map((m) => m.name)))
      .catch(() => setMachines([]));
    load("");
  }, [load]);

  return (
    <div className="hzx-card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          💬 会话 Top 50
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={machine}
            onChange={(e) => { setMachine(e.target.value); load(e.target.value); }}
            className="rounded-md px-3 py-2 text-sm"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
          >
            <option value="">全部机器</option>
            {machines.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button onClick={() => load(machine)} className="hzx-btn !py-2 !px-3 !text-xs">
            刷新
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>加载中...</p>
      ) : items.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>暂无会话数据</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--bg-secondary)" }}>
                <th className="text-left px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>机器</th>
                <th className="text-left px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>Agent</th>
                <th className="text-left px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>会话文件</th>
                <th className="text-right px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>调用</th>
                <th className="text-right px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>输入</th>
                <th className="text-right px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>输出</th>
                <th className="text-right px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>tokens</th>
                <th className="text-right px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>成本</th>
                <th className="text-left px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>最近调用</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s, i) => (
                <tr
                  key={`${s.machine}-${s.session_file}-${i}`}
                  className="border-t text-xs [&:hover]:bg-[var(--hover-bg)]"
                  style={{ borderColor: "var(--border-color)" }}
                >
                  <td className="px-3 py-2" style={{ color: "var(--accent-blue)" }}>{s.machine}</td>
                  <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>{s.agent}</td>
                  <td className="px-3 py-2 truncate max-w-56" title={s.session_file} style={{ color: "var(--text-secondary)" }}>
                    {shortPath(s.session_file)}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--text-primary)" }}>{s.entries.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{fmtTokens(s.input)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{fmtTokens(s.output)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{fmtTokens(s.totalTokens)}</td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ color: "var(--accent-green)" }}>{fmtCost(s.totalCost)}</td>
                  <td className="px-3 py-2" style={{ color: "var(--text-tertiary)" }}>{s.last_ts || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
