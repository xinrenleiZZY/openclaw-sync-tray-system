"use client";

import { useEffect, useState, useCallback } from "react";
import { clientFetch } from "@/lib/api";
import type { AbnormalMachine, AbnormalResult } from "@/lib/api";

const THRESHOLD = 120; // 2 小时
const REFRESH_MS = 30_000;

function fmtIdle(sec: number | null): { text: string; severe: boolean } {
  if (sec == null) return { text: "从未推送", severe: true };
  const s = Math.max(0, sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return { text: `${d}天${h > 0 ? h + "小时" : ""}`, severe: true };
  if (h > 0) return { text: `${h}小时${m > 0 ? m + "分" : ""}`, severe: h >= 24 };
  return { text: `${m}分钟`, severe: false };
}

export default function AbnormalClient() {
  const [data, setData] = useState<AbnormalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const d = await clientFetch<AbnormalResult>(`/api/usage/abnormal-machines?threshold_minutes=${THRESHOLD}`);
      setData(d);
      setLastSync(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      {/* 概览卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="hzx-card">
          <p className="text-2xl font-bold" style={{ color: "var(--accent-red)" }}>
            {data?.abnormal_count ?? "-"}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>异常机器</p>
        </div>
        <div className="hzx-card">
          <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {data?.total_machines ?? "-"}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>机器总数</p>
        </div>
        <div className="hzx-card">
          <p className="text-2xl font-bold" style={{ color: "var(--accent-green)" }}>
            {data ? data.total_machines - data.abnormal_count : "-"}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>正常推送</p>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="hzx-card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              🚨 异常机器
            </h3>
            <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
              判定标准：超过 {THRESHOLD / 60} 小时未推送即视为异常（每 {REFRESH_MS / 1000} 秒自动刷新）
              {lastSync ? ` · 最近同步 ${lastSync}` : ""}
            </p>
          </div>
          <button onClick={load} className="hzx-btn !py-2 !px-3 !text-xs">
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {/* 异常列表 */}
      <div className="hzx-card">
        {loading ? (
          <p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>加载中...</p>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>
            ✅ 所有机器均在正常推送，无异常。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: "var(--bg-secondary)" }}>
                  <th className="text-left px-2 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>机器</th>
                  <th className="text-left px-2 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>系统信息</th>
                  <th className="text-left px-2 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>最近推送</th>
                  <th className="text-left px-2 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>异常时长</th>
                  <th className="text-center px-2 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m: AbnormalMachine) => {
                  const idle = fmtIdle(m.idle_seconds);
                  return (
                    <tr key={m.name} className="border-t" style={{ borderColor: "var(--border-color)" }}>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "var(--accent-red)" }} />
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-40" style={{ color: "var(--text-primary)" }}>{m.alias}</p>
                            {m.name !== m.alias && (
                              <p className="text-xs truncate max-w-40" style={{ color: "var(--text-tertiary)" }}>{m.name}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 truncate max-w-48" style={{ color: "var(--text-secondary)" }}>
                        {m.os_info || "未知系统"}{m.hostname ? ` · ${m.hostname}` : ""}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {m.last_push || "从未推送"}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap font-medium" style={{ color: idle.severe ? "var(--accent-red)" : "var(--accent-orange)" }}>
                        {idle.text}
                      </td>
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[11px]"
                          style={{
                            backgroundColor: m.enabled ? "rgba(52,211,153,0.14)" : "rgba(148,163,184,0.14)",
                            color: m.enabled ? "var(--accent-green)" : "var(--text-tertiary)",
                          }}
                        >
                          {m.enabled ? "启用" : "停用"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
