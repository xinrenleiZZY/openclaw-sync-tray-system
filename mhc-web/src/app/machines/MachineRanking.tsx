"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import EChart from "@/components/EChart";
import { clientFetch } from "@/lib/api";
import { fmtCost, fmtTokens } from "@/lib/format";
import type { MachineDailyResult, MachineRankResult } from "@/lib/api";

const RANK_RANGES = [7, 30, 90] as const;
const PALETTE = ["#3b82f6", "#22d3ee", "#34d399", "#fbbf24", "#a78bfa", "#f87171"];

function PanelTitle({ title, extra }: { title: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h3>
      {extra}
    </div>
  );
}

export default function MachineRanking() {
  const [rankDays, setRankDays] = useState<number>(30);
  const [day, setDay] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [rank, setRank] = useState<MachineRankResult | null>(null);
  const [daily, setDaily] = useState<MachineDailyResult | null>(null);
  const [rankLoading, setRankLoading] = useState(true);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRank = useCallback(async (days: number) => {
    setRankLoading(true);
    setError("");
    try {
      const r = await clientFetch<MachineRankResult>(`/api/usage/machine-rank?days=${days}`);
      setRank(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRankLoading(false);
    }
  }, []);

  const loadDaily = useCallback(async (d: string) => {
    setDailyLoading(true);
    setError("");
    try {
      const r = await clientFetch<MachineDailyResult>(`/api/usage/machine-daily?day=${encodeURIComponent(d)}`);
      setDaily(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDailyLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRank(rankDays);
  }, [loadRank, rankDays]);

  useEffect(() => {
    loadDaily(day);
  }, [loadDaily, day]);

  const rankOption = useMemo<echarts.EChartsOption>(() => {
    const items = (rank?.items ?? []).slice(0, 10).reverse();
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "var(--card-bg)", borderColor: "var(--border-color)", textStyle: { color: "var(--text-primary)", fontSize: 12 } },
      grid: { left: 10, right: 60, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: "value", axisLine: { lineStyle: { color: "var(--border-color)" } }, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => `$${v}` }, splitLine: { lineStyle: { color: "var(--border-color)" } } },
      yAxis: { type: "category", data: items.map((m) => m.alias), axisLine: { lineStyle: { color: "var(--border-color)" } }, axisLabel: { color: "var(--text-secondary)", fontSize: 10 } },
      series: [
        {
          name: "成本",
          type: "bar",
          barWidth: 12,
          data: items.map((m, i) => ({
            value: Number(m.cost.toFixed(4)),
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: "rgba(52,211,153,0.2)" },
                { offset: 1, color: PALETTE[i % PALETTE.length] },
              ]),
              borderRadius: [0, 5, 5, 0],
            },
          })),
          label: { show: true, position: "right", color: "var(--text-secondary)", fontSize: 10, formatter: (p) => `$${Number((p as { value?: unknown }).value ?? 0).toFixed(4)}` },
        },
      ],
    };
  }, [rank]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 机器成本排行 */}
      <div className="hzx-card">
        <PanelTitle
          title="🏆 机器成本排行（每日消耗）"
          extra={
            <div className="flex items-center gap-1 rounded-md p-0.5" style={{ backgroundColor: "var(--bg-secondary)" }}>
              {RANK_RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRankDays(r)}
                  className="px-2 py-1 rounded text-xs"
                  style={{
                    backgroundColor: rankDays === r ? "var(--card-bg)" : "transparent",
                    color: rankDays === r ? "var(--text-primary)" : "var(--text-tertiary)",
                    boxShadow: rankDays === r ? "var(--card-shadow)" : "none",
                    fontWeight: rankDays === r ? 600 : 400,
                  }}
                >
                  {r}天
                </button>
              ))}
            </div>
          }
        />
        {rankLoading ? (
          <div className="flex items-center justify-center" style={{ height: 280 }}>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>加载中…</p>
          </div>
        ) : rank && rank.items.length > 0 ? (
          <>
            <EChart option={rankOption} height={280} />
            <p className="text-xs mt-2 text-center" style={{ color: "var(--text-tertiary)" }}>
              近 {rankDays} 天（{rank.start} ~ {rank.end}）各机器累计成本排行，悬停查看明细
            </p>
          </>
        ) : (
          <div className="flex items-center justify-center" style={{ height: 280 }}>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              近 {rankDays} 天暂无成本数据（可能机器未上报或时间范围早于数据开始日期）
            </p>
          </div>
        )}
      </div>

      {/* 按日期查看机器使用量 */}
      <div className="hzx-card">
        <PanelTitle
          title="📅 按日期查看机器使用量"
          extra={
            <input
              type="date"
              value={day}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="rounded-md px-2 py-1 text-xs"
              style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
            />
          }
        />
        {dailyLoading ? (
          <div className="flex items-center justify-center" style={{ height: 280 }}>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>加载中…</p>
          </div>
        ) : daily && daily.items.length > 0 ? (
          <div className="overflow-x-auto" style={{ maxHeight: 300, overflowY: "auto" }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0" style={{ backgroundColor: "var(--bg-secondary)" }}>
                <tr>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>机器</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>调用</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>输入</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>输出</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>Tokens</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>成本</th>
                </tr>
              </thead>
              <tbody>
                {daily.items.map((it) => (
                  <tr key={it.machine} className="border-t" style={{ borderColor: "var(--border-color)" }}>
                    <td className="px-3 py-2 font-medium truncate max-w-36" style={{ color: "var(--text-primary)" }} title={it.machine}>
                      {it.alias}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{it.calls.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtTokens(it.input)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtTokens(it.output)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtTokens(it.tokens)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: "var(--accent-green)" }}>{fmtCost(it.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center" style={{ height: 280 }}>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {daily ? `${daily.day} 无机器使用记录（该日可能没有机器上报）` : "暂无数据"}
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="lg:col-span-2 hzx-card" style={{ borderColor: "var(--accent-red)" }}>
          <p className="text-sm" style={{ color: "var(--accent-red)" }}>数据加载失败：{error}</p>
        </div>
      )}
    </div>
  );
}
