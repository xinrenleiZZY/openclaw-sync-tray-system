"use client";

import { useEffect, useState, useCallback } from "react";
import { clientFetch } from "@/lib/api";
import { fmtCost, fmtTokens } from "@/lib/format";
import type { PushRecord } from "@/lib/api";

export default function PushClient() {
  const [items, setItems] = useState<PushRecord[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [machine, setMachine] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (m) params.set("machine", m);
      params.set("limit", "50");
      const data = await clientFetch<{ items: PushRecord[] }>(`/api/usage/pushes?${params.toString()}`);
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
          📤 最近推送
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
        <p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>暂无推送记录</p>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.id} className="rounded-lg" style={{ border: "1px solid var(--border-color)" }}>
              <button
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg">📤</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {p.machine}
                      <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-tertiary)" }}>
                        #{p.id}
                      </span>
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {p.received_at} · {p.entries_count} 条
                      {p.duplicates > 0 ? ` · 新增 ${p.inserted} / 重复 ${p.duplicates}` : ""}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--accent-green)" }}>
                    {fmtCost(p.total_cost)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {fmtTokens(p.total_tokens)} tokens
                  </p>
                </div>
              </button>
              {expanded === p.id && (
                <pre
                  className="px-4 pb-3 text-xs overflow-x-auto"
                  style={{ color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', 'Consolas', monospace" }}
                >
                  {JSON.stringify(p.detail, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
