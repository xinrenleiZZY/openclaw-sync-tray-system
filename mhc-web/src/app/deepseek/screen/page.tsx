"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as echarts from "echarts";
import EChart from "@/components/EChart";
import { clientFetch } from "@/lib/api";
import { fmtTokens } from "@/lib/format";
import type { DeepseekOverview } from "@/lib/api";

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
        <h3 className="text-sm font-semibold tracking-wide" style={{ color: "#cfe9ff" }}>{title}</h3>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: React.ReactNode; color: string }) {
  return (
    <div
      className="rounded-lg px-4 py-3 text-center"
      style={{
        background: "rgba(9,22,42,0.72)",
        border: "1px solid rgba(34,211,238,0.22)",
        boxShadow: "0 0 18px rgba(34,211,238,0.06)",
      }}
    >
      <p className="text-xs mb-1.5 tracking-widest" style={{ color: "#6f93ba" }}>{label}</p>
      <p className="text-2xl font-bold leading-tight" style={{ color, fontFamily: "'JetBrains Mono','Consolas',monospace" }}>{value}</p>
      <div className="text-[11px] mt-1" style={{ color: "#4d7198" }}>{sub}</div>
    </div>
  );
}

function fmtCNY(n: number): string {
  return `¥${(n || 0).toFixed(2)}`;
}

export default function DeepseekScreenPage() {
  const [data, setData] = useState<DeepseekOverview | null>(null);
  const [now, setNow] = useState(new Date());
  const [updatedAt, setUpdatedAt] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await clientFetch<DeepseekOverview>("/api/deepseek/overview");
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
      grid: { left: 52, right: 18, top: 30, bottom: 24 },
      legend: { top: 0, right: 0, textStyle: { color: "#8fb0d8", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      xAxis: {
        type: "category",
        data: trend.map((t) => t.date.slice(5)),
        ...AXIS,
        axisLabel: { color: "#8fb0d8", fontSize: 10, interval: Math.ceil(trend.length / 15) - 1 },
      },
      yAxis: [
        { type: "value", name: "成本¥", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `¥${v.toFixed(2)}` } },
        { type: "value", name: "调用", ...AXIS, splitLine: { show: false }, axisLabel: { color: "#8fb0d8", fontSize: 10 } },
      ],
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
          name: "调用",
          type: "bar",
          yAxisIndex: 1,
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
      tooltip: { ...TOOLTIP, trigger: "item", formatter: "{b}<br/>¥{c} ({d}%)" },
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
          data: items.map((m, i) => ({ name: m.model, value: Number(m.cost.toFixed(6)), itemStyle: { color: PALETTE[i % PALETTE.length] } })),
        },
      ],
    };
  }, [data]);

  const keyBarOption = useMemo<echarts.EChartsOption>(() => {
    const items = (data?.api_key_rank ?? []).slice(0, 10).reverse();
    return {
      tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 10, right: 60, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: "value", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `¥${v}` } },
      yAxis: {
        type: "category",
        data: items.map((k) => (k.api_key_name.length > 16 ? `${k.api_key_name.slice(0, 16)}…` : k.api_key_name)),
        ...AXIS,
        axisLabel: { color: "#8fb0d8", fontSize: 10 },
      },
      series: [
        {
          name: "成本",
          type: "bar",
          barWidth: 10,
          data: items.map((k, i) => ({
            value: Number(k.cost.toFixed(4)),
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: "rgba(52,211,153,0.2)" },
                { offset: 1, color: PALETTE[i % PALETTE.length] },
              ]),
              borderRadius: [0, 5, 5, 0],
            },
          })),
          label: { show: true, position: "right", color: "#9fd8b8", fontSize: 10, formatter: (p) => `¥${Number((p as { value?: unknown }).value ?? 0).toFixed(2)}` },
        },
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
      grid: { left: 48, right: 16, top: 30, bottom: 24 },
      xAxis: { type: "category", data: days.map((d) => d.slice(5)), ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10 } },
      yAxis: { type: "value", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `¥${v.toFixed(2)}` } },
      series,
    };
  }, [data]);

  const tokenCompositionOption = useMemo<echarts.EChartsOption>(() => {
    const trend = data?.trend ?? [];
    const toM = (v: number) => Math.round((v || 0) / 1e6);
    return {
      tooltip: { ...TOOLTIP, trigger: "axis" },
      legend: { top: 0, left: 0, textStyle: { color: "#8fb0d8", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 52, right: 16, top: 30, bottom: 24 },
      xAxis: {
        type: "category",
        data: trend.map((t) => t.date.slice(5)),
        ...AXIS,
        axisLabel: { color: "#8fb0d8", fontSize: 10, interval: Math.ceil(trend.length / 15) - 1 },
      },
      yAxis: { type: "value", name: "百万", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `${v}M` } },
      series: [
        { name: "输出", type: "bar", stack: "t", barWidth: "55%", data: trend.map((t) => toM(t.output)), itemStyle: { color: "rgba(59,130,246,0.8)" } },
        { name: "缓存命中", type: "bar", stack: "t", data: trend.map((t) => toM(t.cache_hit)), itemStyle: { color: "rgba(34,211,238,0.8)" } },
        { name: "缓存未命中", type: "bar", stack: "t", data: trend.map((t) => toM(t.cache_miss)), itemStyle: { color: "rgba(167,139,250,0.8)" } },
      ],
    };
  }, [data]);

  const monthlyOption = useMemo<echarts.EChartsOption>(() => {
    const rows = data?.monthly ?? [];
    return {
      tooltip: { ...TOOLTIP, trigger: "axis" },
      legend: { top: 0, right: 0, textStyle: { color: "#8fb0d8", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 52, right: 16, top: 30, bottom: 24 },
      xAxis: { type: "category", data: rows.map((r) => r.month), ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 11 } },
      yAxis: [
        { type: "value", name: "成本¥", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `¥${v}` } },
        { type: "value", name: "调用", ...AXIS, splitLine: { show: false }, axisLabel: { color: "#8fb0d8", fontSize: 10 } },
      ],
      series: [
        { name: "成本", type: "bar", barWidth: 24, data: rows.map((r) => Number(r.cost.toFixed(2))), itemStyle: { color: "#22d3ee", borderRadius: [3, 3, 0, 0] } },
        { name: "调用", type: "line", yAxisIndex: 1, smooth: true, data: rows.map((r) => r.calls), itemStyle: { color: "#fbbf24" }, lineStyle: { color: "#fbbf24", width: 2 } },
      ],
    };
  }, [data]);

  const keyTrendOption = useMemo<echarts.EChartsOption>(() => {
    const rows = data?.api_key_trend ?? [];
    if (!rows.length) return {};
    const keys = [...new Set(rows.map((r) => r.api_key_name))];
    const days = [...new Set(rows.map((r) => r.day))].sort();
    const series = keys.map((k, i) => ({
      name: k.length > 12 ? `${k.slice(0, 12)}…` : k,
      type: "line" as const,
      smooth: true,
      symbol: "circle",
      symbolSize: 3,
      data: days.map((d) => {
        const hit = rows.find((r) => r.day === d && r.api_key_name === k);
        return hit ? Number(hit.cost.toFixed(4)) : 0;
      }),
      lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] },
      itemStyle: { color: PALETTE[i % PALETTE.length] },
    }));
    return {
      tooltip: { ...TOOLTIP, trigger: "axis" },
      legend: { top: 0, left: 0, type: "scroll", textStyle: { color: "#8fb0d8", fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 52, right: 16, top: 30, bottom: 24 },
      xAxis: { type: "category", data: days.map((d) => d.slice(5)), ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, interval: Math.ceil(days.length / 15) - 1 } },
      yAxis: { type: "value", ...AXIS, axisLabel: { color: "#8fb0d8", fontSize: 10, formatter: (v: number) => `¥${v.toFixed(2)}` } },
      series,
    };
  }, [data]);

  const modelCallsPieOption = useMemo<echarts.EChartsOption>(() => {
    const items = (data?.model_rank ?? []).slice(0, 8);
    return {
      tooltip: { ...TOOLTIP, trigger: "item", formatter: "{b}<br/>{c} 次 ({d}%)" },
      legend: { type: "scroll", orient: "vertical", right: 0, top: "middle", textStyle: { color: "#8fb0d8", fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      series: [
        {
          name: "模型调用占比",
          type: "pie",
          radius: ["42%", "68%"],
          center: ["36%", "52%"],
          itemStyle: { borderColor: "#071426", borderWidth: 2 },
          label: { color: "#cfe9ff", fontSize: 11, formatter: "{b}\n{d}%" },
          data: items.map((m, i) => ({ name: m.model, value: m.calls, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
        },
      ],
    };
  }, [data]);

  const calendarOption = useMemo<echarts.EChartsOption>(() => {
    const trend = data?.trend ?? [];
    if (!trend.length) return {};
    const maxCalls = Math.max(...trend.map((t) => t.calls), 1);
    return {
      tooltip: {
        ...TOOLTIP,
        formatter: (p) => {
          const v = p as { value?: [string, number] };
          return v.value ? `${v.value[0]}：${v.value[1].toLocaleString()} 次调用` : "";
        },
      },
      visualMap: {
        min: 0,
        max: maxCalls,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        textStyle: { color: "#8fb0d8", fontSize: 10 },
        inRange: { color: ["#0b1d33", "#0f2f52", "#155e75", "#22d3ee", "#fbbf24"] },
      },
      calendar: {
        range: [trend[0].date, trend[trend.length - 1].date],
        left: 50,
        right: 20,
        top: 20,
        bottom: 50,
        cellSize: ["auto", 14],
        itemStyle: { color: "rgba(9,22,42,0.6)", borderColor: "#0b1d33", borderWidth: 1 },
        dayLabel: { color: "#6f93ba", fontSize: 10 },
        monthLabel: { color: "#8fb0d8", fontSize: 11 },
        yearLabel: { show: false },
      },
      series: [
        {
          type: "heatmap",
          coordinateSystem: "calendar",
          data: trend.map((t) => [t.date, t.calls]),
        },
      ],
    };
  }, [data]);

  const modelRows = data?.model_rank ?? [];
  const keyRows = data?.api_key_rank ?? [];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{
        background: "radial-gradient(ellipse at 50% -20%, rgba(34,211,238,0.10), transparent 55%), radial-gradient(ellipse at 90% 110%, rgba(59,130,246,0.10), transparent 50%), #050b16",
      }}
    >
      <div className="min-h-screen p-4 sm:p-6" style={{ maxWidth: 1720, margin: "0 auto" }}>
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
              Deepseek 用量统计 · 可视化大屏
            </h1>
            <p className="text-xs mt-1 tracking-widest" style={{ color: "#4d7198" }}>
              DEEPSEEK ACCOUNT USAGE MONITOR · 每 30 秒自动刷新{updatedAt ? ` · 更新于 ${updatedAt}` : ""}
              {data?.date_range.min ? ` · 数据 ${data.date_range.min} ~ ${data.date_range.max}` : ""}
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
              href="/deepseek"
              className="rounded-md px-3 py-1.5 text-xs"
              style={{ border: "1px solid rgba(34,211,238,0.35)", color: "#7dd3fc" }}
            >
              ← 返回统计中心
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
          <KpiCard label="总调用次数" value={(data?.calls ?? 0).toLocaleString()} sub={`数据 ${data?.date_range.min || "-"} ~ ${data?.date_range.max || "-"}`} color="#60a5fa" />
          <KpiCard label="总 Tokens" value={fmtTokens(data?.tokens ?? 0)} sub={`输入 ${fmtTokens(data?.input ?? 0)} / 输出 ${fmtTokens(data?.output ?? 0)}`} color="#22d3ee" />
          <KpiCard label="总成本" value={fmtCNY(data?.totalCost ?? 0)} sub={<><p>币种 CNY（账号维度）</p><p className="mt-0.5" style={{ color: "#4ade80" }}>模型实际用量：{fmtCNY(data?.balance?.actual_usage ?? 0)} · 为目前总消耗</p></>} color="#34d399" />
          <KpiCard label="最新日期成本" value={fmtCNY(data?.latest_cost ?? 0)} sub={`${data?.latest_date || "-"} · ${(data?.latest_calls ?? 0).toLocaleString()} 次调用`} color="#fbbf24" />
          <KpiCard label="已上传文件" value={String(data?.imports ?? 0)} sub={`最近上传 ${data?.last_import || "-"}`} color="#a78bfa" />
        </div>

        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 lg:col-span-8">
            <Panel title="每日成本与调用趋势">
              <EChart option={trendOption} height={280} />
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <Panel title="模型成本占比">
              <EChart option={modelPieOption} height={280} />
            </Panel>
          </div>

          <div className="col-span-12 lg:col-span-4">
            <Panel title="模型调用占比">
              <EChart option={modelCallsPieOption} height={280} />
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-8">
            <Panel title="每日 Token 构成（输出 / 缓存命中 / 缓存未命中）">
              <EChart option={tokenCompositionOption} height={280} />
            </Panel>
          </div>

          <div className="col-span-12 lg:col-span-4">
            <Panel title="月度成本与调用对比">
              <EChart option={monthlyOption} height={300} />
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <Panel title="模型成本 TOP 10">
              <div className="h-full overflow-y-auto pr-1" style={{ height: 300 }}>
                {modelRows.length === 0 ? (
                  <p className="text-xs pt-6 text-center" style={{ color: "#4d7198" }}>暂无数据</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: "#6f93ba" }}>
                        <th className="text-left py-1.5 font-medium">#</th>
                        <th className="text-left py-1.5 font-medium">模型</th>
                        <th className="text-right py-1.5 font-medium">调用</th>
                        <th className="text-right py-1.5 font-medium">Tokens</th>
                        <th className="text-right py-1.5 font-medium">成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelRows.slice(0, 10).map((m, i) => (
                        <tr key={m.model} className="border-t" style={{ borderColor: "rgba(30,58,95,0.4)", color: "#9fc3e8" }}>
                          <td className="py-1.5 pr-2" style={{ color: PALETTE[i % PALETTE.length] }}>{i + 1}</td>
                          <td className="py-1.5 pr-2 truncate max-w-40">{m.model}</td>
                          <td className="py-1.5 text-right tabular-nums">{m.calls}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmtTokens(m.tokens)}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: "#34d399" }}>¥{m.cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <Panel title="API Key 明细">
              <div className="h-full overflow-y-auto pr-1" style={{ height: 300 }}>
                {keyRows.length === 0 ? (
                  <p className="text-xs pt-6 text-center" style={{ color: "#4d7198" }}>暂无数据</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: "#6f93ba" }}>
                        <th className="text-left py-1.5 font-medium">#</th>
                        <th className="text-left py-1.5 font-medium">API Key 名称</th>
                        <th className="text-right py-1.5 font-medium">调用</th>
                        <th className="text-right py-1.5 font-medium">Tokens</th>
                        <th className="text-right py-1.5 font-medium">成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keyRows.slice(0, 10).map((k, i) => (
                        <tr key={`${k.api_key_name}-${i}`} className="border-t" style={{ borderColor: "rgba(30,58,95,0.4)", color: "#9fc3e8" }}>
                          <td className="py-1.5 pr-2" style={{ color: PALETTE[i % PALETTE.length] }}>{i + 1}</td>
                          <td className="py-1.5 pr-2 truncate max-w-36" title={k.api_key_name}>{k.api_key_name}</td>
                          <td className="py-1.5 text-right tabular-nums">{k.calls}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmtTokens(k.tokens)}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ color: "#34d399" }}>¥{k.cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Panel>
          </div>

          <div className="col-span-12 lg:col-span-6">
            <Panel title="模型每日成本走势">
              <EChart option={modelTrendOption} height={300} />
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-6">
            <Panel title="API Key 每日成本走势（Top 6，估算）">
              <EChart option={keyTrendOption} height={300} />
            </Panel>
          </div>

          <div className="col-span-12 lg:col-span-6">
            <Panel title="API Key 成本排行 TOP 10">
              <EChart option={keyBarOption} height={300} />
            </Panel>
          </div>
          <div className="col-span-12 lg:col-span-6">
            <Panel title="每日调用活跃度日历">
              <EChart option={calendarOption} height={300} />
            </Panel>
          </div>
        </div>

        <p className="text-center text-[11px] mt-4 pb-2 tracking-widest" style={{ color: "#33506f" }}>
          MHC · Deepseek 用量统计中心 V1.0.0 · 数据来源于账号维度 amount/cost CSV 上传，与 OpenClaw 机器用量相互独立
        </p>
      </div>
    </div>
  );
}
