"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import EChart from "@/components/EChart";
import { getHourly } from "@/lib/api";
import type { HourlyMachine, HourlyResult } from "@/lib/api";
import { fmtTokens } from "@/lib/format";

const PALETTE = ["#22d3ee", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#60a5fa", "#f472b6", "#4ade80"];

type Metric = "cost" | "tokens";

const AXIS_DARK = {
  axisLine: { lineStyle: { color: "#1e3a5f" } },
  axisLabel: { color: "#8fb0d8", fontSize: 11 },
  splitLine: { lineStyle: { color: "rgba(30,58,95,0.35)" } },
};

const TOOLTIP_DARK: echarts.TooltipComponentOption = {
  backgroundColor: "rgba(8,20,38,0.94)",
  borderColor: "#1e3a5f",
  textStyle: { color: "#d7e6f8", fontSize: 12 },
};

function hexRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function fmtMoney(n: number): string {
  return `$${(n || 0).toFixed(4)}`;
}

function fmtMetric(mode: Metric, v: number): string {
  return mode === "cost" ? fmtMoney(v) : `${fmtTokens(v)}`;
}

export default function LifeFormView({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<HourlyResult | null>(null);
  const [now, setNow] = useState(new Date());
  const [updatedAt, setUpdatedAt] = useState("");
  const [mode, setMode] = useState<Metric>("cost");

  const load = useCallback(async () => {
    try {
      const d = await getHourly(24);
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

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const option = useMemo<echarts.EChartsOption>(() => {
    const machines = (data?.machines ?? [])
      .map((m) => ({ ...m, series: mode === "cost" ? m.data : m.token_data, total: mode === "cost" ? m.total_cost : m.total_tokens }))
      .sort((a, b) => b.total - a.total);
    const hours = data?.hours ?? [];
    const top = machines.slice(0, 8);
    const top3 = machines.slice(0, 3);
    if (!top.length || !hours.length) return {};

    const lastIdx = hours.length - 1;
    const maxVal = Math.max(...top.map((m) => Math.max(...m.series)), 0.0001);
    const yMax = Math.ceil(maxVal * 1.25 * 100) / 100;

    const lineSeries: echarts.SeriesOption[] = top.map((m, i) => {
      const color = PALETTE[i % PALETTE.length];
      const isTop3 = i < 3;
      return {
        name: m.alias,
        type: "line",
        smooth: 0.35,
        symbol: "circle",
        symbolSize: (v: number, p: { dataIndex: number }) => (isTop3 && p.dataIndex === lastIdx ? 7 : 3),
        data: m.series.map((v, idx) =>
          isTop3 && idx === lastIdx
            ? {
                value: v,
                symbolSize: 8,
                itemStyle: {
                  color,
                  shadowBlur: 22,
                  shadowColor: color,
                  borderColor: "#ffffff",
                  borderWidth: 1,
                },
              }
            : v
        ),
        lineStyle: { width: isTop3 ? 2.6 : 1.6, color },
        itemStyle: { color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: hexRgba(color, 0.3) },
            { offset: 1, color: hexRgba(color, 0.02) },
          ]),
        },
        emphasis: { focus: "series" },
        z: isTop3 ? 3 : 1,
      };
    });

    // 前三名最新点：光芒闪烁（effectScatter 脉动叠加）
    const glowSeries: echarts.SeriesOption[] = top3.map((m, i) => {
      const color = PALETTE[i % PALETTE.length];
      return {
        name: `${m.alias}·脉动`,
        type: "effectScatter",
        coordinateSystem: "cartesian2d",
        zlevel: 5,
        symbolSize: 10,
        rippleEffect: { brushType: "stroke", scale: 3.2, period: 2.2 },
        itemStyle: { color, shadowBlur: 26, shadowColor: color },
        label: {
          show: true,
          position: "top",
          distance: 10,
          formatter: `${m.alias} ${fmtMetric(mode, m.series[lastIdx] ?? 0)}`,
          color,
          fontSize: 11,
          fontWeight: 700,
          textShadowBlur: 10,
          textShadowColor: color,
        },
        data: [[lastIdx, m.series[lastIdx] ?? 0]],
      };
    });

    // X 轴聚焦：超过 24 小时窗口时，默认聚焦最近 24 小时
    const focusStart = hours.length > 24 ? ((hours.length - 24) / hours.length) * 100 : 0;

    return {
      tooltip: {
        ...TOOLTIP_DARK,
        trigger: "axis",
        valueFormatter: (v) => fmtMetric(mode, Number(v)),
      },
      legend: {
        top: 0,
        left: 0,
        type: "scroll",
        textStyle: { color: "#8fb0d8", fontSize: 11 },
        itemWidth: 14,
        itemHeight: 8,
      },
      grid: { left: 58, right: 24, top: 40, bottom: 30 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: hours,
        ...AXIS_DARK,
        axisLabel: { color: "#8fb0d8", fontSize: 10, interval: Math.ceil(hours.length / 12) - 1 },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: yMax,
        ...AXIS_DARK,
        axisLabel: {
          color: "#8fb0d8",
          fontSize: 10,
          formatter: (v: number) => (mode === "cost" ? `$${v.toFixed(2)}` : fmtTokens(v)),
        },
      },
      dataZoom: [
        { type: "inside", start: focusStart, end: 100 },
        { type: "slider", start: focusStart, end: 100, height: 14, bottom: 6, borderColor: "#1e3a5f", backgroundColor: "rgba(30,58,95,0.2)", fillerColor: "rgba(34,211,238,0.12)", handleStyle: { color: "#22d3ee" }, textStyle: { color: "#8fb0d8", fontSize: 9 } },
      ],
      animationDurationUpdate: 900,
      series: [...lineSeries, ...glowSeries],
    };
  }, [data, mode]);

  const machines = data?.machines ?? [];
  const totalCost = machines.reduce((s, m) => s + (m.total_cost || 0), 0);
  const totalTokens = machines.reduce((s, m) => s + (m.total_tokens || 0), 0);
  const activeSeries = (m: HourlyMachine) => (mode === "cost" ? m.data : m.token_data);
  const activeMachines = machines.filter((m) => activeSeries(m).some((v) => v > 0)).length;
  const peak = Math.max(...machines.map((m) => Math.max(...activeSeries(m))), 0);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{
        background: "radial-gradient(ellipse at 50% -20%, rgba(34,211,238,0.12), transparent 55%), radial-gradient(ellipse at 90% 110%, rgba(167,139,250,0.10), transparent 50%), #050b16",
      }}
    >
      <div className="min-h-screen p-4 sm:p-6" style={{ maxWidth: 1600, margin: "0 auto" }}>
        {/* 标题栏 */}
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1
              className="text-2xl font-bold tracking-[0.15em]"
              style={{
                color: "#e8f6ff",
                textShadow: "0 0 20px rgba(34,211,238,0.6), 0 0 40px rgba(52,211,153,0.3)",
                fontFamily: "'JetBrains Mono','Consolas',monospace",
              }}
            >
              生命形态解析
            </h1>
            <p className="text-xs mt-1.5 tracking-widest" style={{ color: "#4d7198" }}>
              每小时 · 每台机器实时用量 · 每 30 秒自动刷新 {updatedAt ? `· 更新于 ${updatedAt}` : ""}
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
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-white/5"
              style={{ border: "1px solid rgba(34,211,238,0.35)", color: "#7dd3fc" }}
            >
              ← 返回仪表盘
            </button>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Kpi label="活跃机器" value={`${activeMachines} 台`} sub={`共接入 ${machines.length} 台`} color="#22d3ee" />
          <Kpi label="当前小时峰值" value={fmtMetric(mode, peak)} sub={mode === "cost" ? "单机单小时成本" : "单机单小时 Token"} color="#fbbf24" />
          {mode === "cost" ? (
            <Kpi label="近 24h 总成本" value={fmtMoney(totalCost)} sub="所有机器合计" color="#34d399" />
          ) : (
            <Kpi label="近 24h 总 Token" value={fmtTokens(totalTokens)} sub="所有机器合计" color="#34d399" />
          )}
          <Kpi label="实时刷新" value="30s" sub={`已同步 ${updatedAt || "-"}`} color="#a78bfa" />
        </div>

        {/* 大卡片：实时动态折线 */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: "rgba(9,22,42,0.78)",
            border: "1px solid rgba(34,211,238,0.25)",
            boxShadow: "0 0 30px rgba(34,211,238,0.08), inset 0 0 30px rgba(10,30,60,0.35)",
          }}
        >
          <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(34,211,238,0.18)" }}>
            <div className="flex items-center gap-2">
              <span className="w-1 h-3.5 rounded-full" style={{ background: "linear-gradient(180deg,#22d3ee,#34d399)" }} />
              <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#cfe9ff" }}>
                每台机器每小时用量（近 24 小时）
              </h3>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 rounded-md p-0.5" style={{ backgroundColor: "rgba(9,22,42,0.6)", border: "1px solid rgba(34,211,238,0.25)" }}>
                {(["cost", "tokens"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="px-3 py-1 rounded text-xs font-medium transition-all"
                    style={{
                      backgroundColor: mode === m ? "#22d3ee" : "transparent",
                      color: mode === m ? "#04121f" : "#7dd3fc",
                      boxShadow: mode === m ? "0 0 12px rgba(34,211,238,0.5)" : "none",
                    }}
                  >
                    {m === "cost" ? "💰 成本" : "🔢 Token"}
                  </button>
                ))}
              </div>
              <span className="text-[11px] tabular-nums hidden sm:block" style={{ color: "#4d7198" }}>
                前三名最新点 · 光芒脉动
              </span>
            </div>
          </div>
          <EChart option={option} height={560} />
        </div>

        <p className="text-center text-[11px] mt-4 pb-2 tracking-widest" style={{ color: "#33506f" }}>
          LIFE FORM · 以当下最高值为轴心动态聚焦 · 股票趋势攀升风格
        </p>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{
        background: "rgba(9,22,42,0.72)",
        border: "1px solid rgba(34,211,238,0.22)",
        boxShadow: "0 0 18px rgba(34,211,238,0.06)",
      }}
    >
      <p className="text-[11px] mb-1 tracking-widest" style={{ color: "#6f93ba" }}>
        {label}
      </p>
      <p className="text-xl font-bold leading-tight tabular-nums" style={{ color, fontFamily: "'JetBrains Mono','Consolas',monospace" }}>
        {value}
      </p>
      <p className="text-[11px] mt-1 truncate" style={{ color: "#4d7198" }}>
        {sub}
      </p>
    </div>
  );
}
