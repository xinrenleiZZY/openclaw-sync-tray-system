"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as echarts from "echarts";
import EChart from "@/components/EChart";
import { clientFetch } from "@/lib/api";
import { fmtTokens } from "@/lib/format";
import type { ScreenData } from "@/lib/api";

const PALETTE = ["#3b82f6", "#22d3ee", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#f472b6", "#4ade80", "#60a5fa", "#c084fc"];

const AXIS = {
  axisLine: { lineStyle: { color: "#1e3a5f" } },
  axisLabel: { color: "#8fb0d8", fontSize: 11 },
  splitLine: { lineStyle: { color: "rgba(30,58,95,0.35)" } },
};

const TOOLTIP: echarts.TooltipComponentOption = {
  backgroundColor: "rgba(8,20,38,0.92)",
  borderColor: "#1e3a5f",
  textStyle: { color: "#d7e6f8", fontSize: 12 },
};

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg p-3 flex flex-col ${className}`}
      style={{
        background: "rgba(9,22,42,0.72)",
        border: "1px solid rgba(34,211,238,0.22)",
        boxShadow: "0 0 18px rgba(34,211,238,0.06), inset 0 0 24px rgba(10,30,60,0.35)",
      }}
    >
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <span className="w-1 h-3.5 rounded-full" style={{ background: "linear-gradient(180deg,#22d3ee,#3b82f6)" }} />
        <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#cfe9ff" }}>
          {title}
        </h3>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div
      className="rounded-lg px-4 py-3 text-center"
      style={{
        background: "rgba(9,22,42,0.72)",
        border: "1px solid rgba(34,211,238,0.22)",
        boxShadow: "0 0 18px rgba(34,211,238,0.06)",
      }}
    >
      <p className="text-xs mb-1.5 tracking-widest" style={{ color: "#6f93ba" }}>
        {label}
      </p>
      <p className="text-2xl font-bold leading-tight" style={{ color, fontFamily: "'JetBrains Mono','Consolas',monospace" }}>
        {value}
      </p>
      <p className="text-[11px] mt-1 truncate" style={{ color: "#4d7198" }}>
        {sub}
      </p>
    </div>
  );
}

function fmtMoney(n: number): string {
  return `$${(n || 0).toFixed(2)}`;
}

export default function BigScreenPage() {
  const [data, setData] = useState<ScreenData | null>(null);
  const [now, setNow] = useState(new Date());
  const [updatedAt, setUpdatedAt] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await clientFetch<ScreenData>("/api/usage/screen?days=30");
      setData(d);
      setUpdatedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } catch {
      // 保留旧数据，下次刷新重试
    }
  }, []);

  useEffect(() => {
    load();
    const dataTimer = setInterval(load, 30000);
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    };
  }, [load]);

  const trendOption = useMemo<echarts.EChartsOption>(() => {
    const trend = data?.trend ?? [];
    return {
      tooltip: { ...TOOLTIP, trigger: "axis" },
      grid: { left: 46, right: 18, top: 28, bottom: 24 },
      xAxis: {
        type: "category",
        data: trend.map((t) => t.date.slice(5)),
        ...AXIS,
        axisLabel: { color: "#8fb0d8", fontSize: 10, interval: Math.ceil(trend.length / 15) - 1 },
      },
      yAxis: { type: "value", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `$${v.toFixed(2)}` } },
      series: [
        {
          name: "成本",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 4,
          data: trend.map((t) => Number(t.cost.toFixed(4))),
          lineStyle: { color: "#22d3ee", width: 2 },
          itemStyle: { color: "#22d3ee" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(34,211,238,0.35)" },
              { offset: 1, color: "rgba(34,211,238,0.02)" },
            ]),
          },
        },
        {
          name: "调用次数",
          type: "bar",
          yAxisIndex: 0,
          barWidth: 6,
          data: trend.map((t) => t.calls),
          itemStyle: { color: "rgba(59,130,246,0.45)", borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [data]);

  const modelPieOption = useMemo<echarts.EChartsOption>(() => {
    const items = (data?.model_rank ?? []).slice(0, 8);
    return {
      tooltip: { ...TOOLTIP, trigger: "item", formatter: "{b}<br/>${c} ({d}%)" },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 0,
        top: "middle",
        textStyle: { color: "#8fb0d8", fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
      },
      series: [
        {
          name: "模型成本占比",
          type: "pie",
          radius: ["42%", "68%"],
          center: ["36%", "52%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#071426", borderWidth: 2 },
          label: { color: "#cfe9ff", fontSize: 11, formatter: "{b}\n{d}%" },
          data: items.map((m, i) => ({ name: m.name, value: Number(m.totalCost.toFixed(6)), itemStyle: { color: PALETTE[i % PALETTE.length] } })),
        },
      ],
    };
  }, [data]);

  const modelBarOption = useMemo<echarts.EChartsOption>(() => {
    const items = (data?.model_rank ?? []).slice(0, 10).reverse();
    return {
      tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 10, right: 24, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: "value", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `$${v}` } },
      yAxis: {
        type: "category",
        data: items.map((m) => (m.name.length > 22 ? `${m.name.slice(0, 22)}…` : m.name)),
        ...AXIS,
        axisLabel: { color: "#8fb0d8", fontSize: 10 },
      },
      series: [
        {
          name: "成本",
          type: "bar",
          barWidth: 10,
          data: items.map((m, i) => ({
            value: Number(m.totalCost.toFixed(4)),
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: "rgba(59,130,246,0.25)" },
                { offset: 1, color: PALETTE[i % PALETTE.length] },
              ]),
              borderRadius: [0, 5, 5, 0],
            },
          })),
        },
      ],
    };
  }, [data]);

  const agentBarOption = useMemo<echarts.EChartsOption>(() => {
    const items = (data?.agent_rank ?? []).slice(0, 10);
    return {
      tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 40, right: 16, top: 30, bottom: 24 },
      legend: { top: 0, right: 0, textStyle: { color: "#8fb0d8", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      xAxis: { type: "category", data: items.map((a) => a.name), ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, interval: 0, rotate: items.length > 6 ? 30 : 0 } },
      yAxis: [
        { type: "value", name: "成本$", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10 } },
        { type: "value", name: "次数", ...AXIS, splitLine: { show: false }, axisLabel: { color: "#8fb0d8", fontSize: 10 } },
      ],
      series: [
        { name: "成本", type: "bar", barWidth: 10, data: items.map((a) => Number(a.totalCost.toFixed(4))), itemStyle: { color: "#3b82f6", borderRadius: [3, 3, 0, 0] } },
        { name: "调用", type: "line", yAxisIndex: 1, smooth: true, data: items.map((a) => a.calls), itemStyle: { color: "#fbbf24" }, lineStyle: { color: "#fbbf24", width: 2 } },
      ],
    };
  }, [data]);

  const modelTrendOption = useMemo<echarts.EChartsOption>(() => {
    const rows = data?.model_trend ?? [];
    if (!rows.length) return {};
    const costByModel: Record<string, number> = {};
    rows.forEach((r) => { costByModel[r.model] = (costByModel[r.model] ?? 0) + r.cost; });
    const topModels = Object.entries(costByModel).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m]) => m);
    const days = [...new Set(rows.map((r) => r.day))].sort();
    const series = topModels.map((m, i) => ({
      name: m,
      type: "line" as const,
      smooth: true,
      symbol: "circle",
      symbolSize: 3,
      data: days.map((d) => {
        const hit = rows.find((r) => r.day === d && r.model === m);
        return hit ? Number(hit.cost.toFixed(4)) : 0;
      }),
      lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] },
      itemStyle: { color: PALETTE[i % PALETTE.length] },
    }));
    return {
      tooltip: { ...TOOLTIP, trigger: "axis" },
      legend: { top: 0, left: 0, type: "scroll", textStyle: { color: "#8fb0d8", fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 44, right: 16, top: 30, bottom: 24 },
      xAxis: { type: "category", data: days.map((d) => d.slice(5)), ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10 } },
      yAxis: { type: "value", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `$${v.toFixed(2)}` } },
      series,
    };
  }, [data]);

  const machineRankOption = useMemo<echarts.EChartsOption>(() => {
    const items = (data?.machine_rank ?? []).slice(0, 10).reverse();
    return {
      tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 10, right: 50, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: "value", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `$${v}` } },
      yAxis: { type: "category", data: items.map((m) => m.alias), ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10 } },
      series: [
        {
          name: "成本",
          type: "bar",
          barWidth: 10,
          data: items.map((m, i) => ({
            value: Number(m.totalCost.toFixed(4)),
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: "rgba(52,211,153,0.2)" },
                { offset: 1, color: "#34d399" },
              ]),
              borderRadius: [0, 5, 5, 0],
            },
          })),
          label: {
            show: true,
            position: "right",
            color: "#9fd8b8",
            fontSize: 10,
            formatter: (p) => `$${Number((p as { value?: unknown }).value ?? 0).toFixed(2)}`,
          },
        },
      ],
    };
  }, [data]);

  const sessions = data?.sessions ?? [];
  const tokenTotal = (data?.input ?? 0) + (data?.output ?? 0) + (data?.cacheRead ?? 0) + (data?.cacheWrite ?? 0) || 1;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{
        background: "radial-gradient(ellipse at 50% -20%, rgba(34,211,238,0.10), transparent 55%), radial-gradient(ellipse at 90% 110%, rgba(59,130,246,0.10), transparent 50%), #050b16",
      }}
    >
      <div className="min-h-screen p-4 sm:p-6" style={{ maxWidth: 1720, margin: "0 auto" }}>
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1
              className="text-2xl font-bold tracking-[0.2em]"
              style={{
                color: "#e8f6ff",
                textShadow: "0 0 18px rgba(34,211,238,0.55)",
                fontFamily: "'JetBrains Mono','Consolas',monospace",
              }}
            >
              模型健康监控中心 · 可视化大屏
            </h1>
            <p className="text-xs mt-1 tracking-widest" style={{ color: "#4d7198" }}>
              OPENCLAW USAGE MONITOR · 每 30 秒自动刷新 {updatedAt ? `· 更新于 ${updatedAt}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xl font-bold tabular-nums" style={{ color: "#7dd3fc", fontFamily: "'JetBrains Mono','Consolas',monospace" }}>
                {now.toLocaleTimeString("zh-CN", { hour12: false })}
              </p>
              <p className="text-xs" style={{ color: "#4d7198" }}>
                {now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })}
              </p>
            </div>
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-1.5 text-xs"
              style={{ border: "1px solid rgba(34,211,238,0.35)", color: "#7dd3fc" }}
            >
              ← 返回控制台
            </Link>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
          <KpiCard label="接入机器" value={String(data?.machines ?? 0)} sub="台虚拟机/主机" color="#60a5fa" />
          <KpiCard label="总调用次数" value={(data?.calls ?? 0).toLocaleString()} sub={`累计 ${fmtTokens(data?.totalTokens ?? 0)} tokens`} color="#22d3ee" />
          <KpiCard label="总成本" value={fmtMoney(data?.totalCost ?? 0)} sub={`≈ ¥${((data?.totalCost ?? 0) * 7.2).toFixed(2)}`} color="#34d399" />
          <KpiCard label="今日成本" value={fmtMoney(data?.today_cost ?? 0)} sub={`今日 ${(data?.today_calls ?? 0).toLocaleString()} 次调用`} color="#fbbf24" />
          <KpiCard label="Token 构成" value={fmtTokens(tokenTotal)} sub={`输 ${fmtTokens(data?.input ?? 0)} / 出 ${fmtTokens(data?.output ?? 0)}`} color="#a78bfa" />
        </div>

        {/* 图表区 */}
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 lg:col-span-8">
            <Panel title="近 30 天成本与调用趋势">
              <EChart option={trendOption} height={280} />
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <Panel title="模型成本占比">
              <EChart option={modelPieOption} height={280} />
            </Panel>
          </div>

          <div className="col-span-12 lg:col-span-4">
            <Panel title="模型成本 TOP 10">
              <EChart option={modelBarOption} height={280} />
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <Panel title="模型 14 天成本走势">
              <EChart option={modelTrendOption} height={280} />
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <Panel title="Agent 成本与调用">
              <EChart option={agentBarOption} height={280} />
            </Panel>
          </div>

          <div className="col-span-12 lg:col-span-7">
            <Panel title="机器成本排行">
              <EChart option={machineRankOption} height={300} />
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-5">
            <Panel title="会话成本 TOP 10">
              <div className="h-full overflow-y-auto pr-1" style={{ height: 300 }}>
                {sessions.length === 0 ? (
                  <p className="text-xs pt-6 text-center" style={{ color: "#4d7198" }}>暂无会话数据</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: "#6f93ba" }}>
                        <th className="text-left py-1.5 font-medium">#</th>
                        <th className="text-left py-1.5 font-medium">机器 / Agent</th>
                        <th className="text-right py-1.5 font-medium">调用</th>
                        <th className="text-right py-1.5 font-medium">Tokens</th>
                        <th className="text-right py-1.5 font-medium">成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s, i) => (
                        <tr key={`${s.machine}-${s.session_id}-${i}`} className="border-t" style={{ borderColor: "rgba(30,58,95,0.4)", color: "#9fc3e8" }}>
                          <td className="py-1.5 pr-2" style={{ color: PALETTE[i % PALETTE.length] }}>{i + 1}</td>
                          <td className="py-1.5 pr-2 truncate max-w-36">
                            <span style={{ color: "#7dd3fc" }}>{s.machine}</span>
                            <span style={{ color: "#4d7198" }}> / {s.agent}</span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{s.calls}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmtTokens(s.tokens)}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: "#34d399" }}>${s.cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Panel>
          </div>
        </div>

        <p className="text-center text-[11px] mt-4 pb-2 tracking-widest" style={{ color: "#33506f" }}>
          MHC · 模型健康监控中心 V1.0.0 · 数据来源于各虚拟机 OpenClaw 用量缓存
        </p>
      </div>
    </div>
  );
}
