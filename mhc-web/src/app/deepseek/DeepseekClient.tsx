"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as echarts from "echarts";
import EChart from "@/components/EChart";
import {
  clientFetch,
  getDeepseekBalance,
  getDeepseekImports,
  getDeepseekKeyDetail,
  getDeepseekKeyUsage,
  getDeepseekTopups,
  getOwnerUsage,
  parseDeepseekTopups,
  refreshDeepseekBalance,
  uploadDeepseekFiles,
} from "@/lib/api";
import { fmtCNY, fmtTokens } from "@/lib/format";
import type {
  DeepseekBalanceInfo,
  DeepseekImportRecord,
  DeepseekKeyDetail,
  DeepseekKeyUsage,
  DeepseekOverview,
  DeepseekTopup,
  DeepseekUploadResult,
  OwnerUsage,
} from "@/lib/api";

const PALETTE = ["#3b82f6", "#22d3ee", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#f472b6", "#4ade80", "#60a5fa", "#c084fc"];

const AXIS_LIGHT = {
  axisLine: { lineStyle: { color: "var(--border-color)" } },
  axisLabel: { color: "var(--text-secondary)", fontSize: 11 },
  splitLine: { lineStyle: { color: "var(--border-color)" } },
};

const TOOLTIP: echarts.TooltipComponentOption = {
  backgroundColor: "var(--card-bg)",
  borderColor: "var(--border-color)",
  textStyle: { color: "var(--text-primary)", fontSize: 12 },
};

// 本地时区 YYYY-MM-DD（与后端 SH_TZ 保持一致）
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: React.ReactNode; color: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: "var(--card-bg)",
        border: "1px solid var(--border-color)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>{sub}</div>
    </div>
  );
}

function ChartPanel({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="hzx-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h3>
        {extra}
      </div>
      {children}
    </div>
  );
}

export default function DeepseekClient() {
  const [data, setData] = useState<DeepseekOverview | null>(null);
  const [imports, setImports] = useState<DeepseekImportRecord[]>([]);
  const [balance, setBalance] = useState<DeepseekBalanceInfo | null>(null);
  const [topups, setTopups] = useState<DeepseekTopup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<DeepseekUploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // 余额/充值
  const [refreshingBal, setRefreshingBal] = useState(false);
  const [balMsg, setBalMsg] = useState("");
  const [balError, setBalError] = useState("");
  const [topupText, setTopupText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [topupMsg, setTopupMsg] = useState("");
  const [topupError, setTopupError] = useState("");

  // 详细使用卡片：选定 Key + 时间维度
  const [selectedKey, setSelectedKey] = useState("__all__");
  const [keyStart, setKeyStart] = useState("");
  const [keyEnd, setKeyEnd] = useState("");
  const [keyDetail, setKeyDetail] = useState<DeepseekKeyDetail | null>(null);
  const [keyDetailLoading, setKeyDetailLoading] = useState(false);
  const [keyDetailError, setKeyDetailError] = useState("");

  // 各 Key 用量与占比卡片：只看时间维度
  const [usageStart, setUsageStart] = useState("");
  const [usageEnd, setUsageEnd] = useState("");
  const [usageData, setUsageData] = useState<DeepseekKeyUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");

  // 各 Key（归属人员）用量与占比卡片：只看时间维度
  const [ownerStart, setOwnerStart] = useState("");
  const [ownerEnd, setOwnerEnd] = useState("");
  const [ownerData, setOwnerData] = useState<OwnerUsage | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [ov, im, bal, tp] = await Promise.all([
        clientFetch<DeepseekOverview>("/api/deepseek/overview"),
        getDeepseekImports(),
        getDeepseekBalance(),
        getDeepseekTopups(50),
      ]);
      setData(ov);
      setImports(im.items);
      setBalance(bal);
      setTopups(tp.items);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 默认时间区间：近 30 天
  useEffect(() => {
    if (!keyStart && !keyEnd) {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 29);
      setKeyEnd(toDateStr(end));
      setKeyStart(toDateStr(start));
    }
  }, [keyStart, keyEnd]);

  // 快捷时间区间
  const setPreset = (d: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (d - 1));
    setKeyEnd(toDateStr(end));
    setKeyStart(toDateStr(start));
  };

  const rangeInvalid = !!(keyStart && keyEnd && keyStart > keyEnd);

  // 加载选定 Key 的每日明细
  const loadKeyDetail = useCallback(async (key: string, start: string, end: string) => {
    if (!key) return;
    setKeyDetailLoading(true);
    setKeyDetailError("");
    try {
      const res = await getDeepseekKeyDetail(key, undefined, start, end);
      setKeyDetail(res);
    } catch (e) {
      setKeyDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      setKeyDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedKey || !keyStart || !keyEnd || rangeInvalid) return;
    loadKeyDetail(selectedKey, keyStart, keyEnd);
  }, [selectedKey, keyStart, keyEnd, rangeInvalid, loadKeyDetail]);

  // 各 Key 用量卡片：默认时间区间（近 30 天）
  useEffect(() => {
    if (!usageStart && !usageEnd) {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 29);
      setUsageEnd(toDateStr(end));
      setUsageStart(toDateStr(start));
    }
  }, [usageStart, usageEnd]);

  const setUsagePreset = (d: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (d - 1));
    setUsageEnd(toDateStr(end));
    setUsageStart(toDateStr(start));
  };

  const usageRangeInvalid = !!(usageStart && usageEnd && usageStart > usageEnd);

  const loadKeyUsage = useCallback(async (start: string, end: string) => {
    setUsageLoading(true);
    setUsageError("");
    try {
      const res = await getDeepseekKeyUsage(undefined, start, end);
      setUsageData(res);
    } catch (e) {
      setUsageError(e instanceof Error ? e.message : String(e));
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!usageStart || !usageEnd || usageRangeInvalid) return;
    loadKeyUsage(usageStart, usageEnd);
  }, [usageStart, usageEnd, usageRangeInvalid, loadKeyUsage]);

  // 各 Key（归属人员）用量卡片：默认时间区间（近 30 天）
  useEffect(() => {
    if (!ownerStart && !ownerEnd) {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 29);
      setOwnerEnd(toDateStr(end));
      setOwnerStart(toDateStr(start));
    }
  }, [ownerStart, ownerEnd]);

  const setOwnerPreset = (d: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (d - 1));
    setOwnerEnd(toDateStr(end));
    setOwnerStart(toDateStr(start));
  };

  const ownerRangeInvalid = !!(ownerStart && ownerEnd && ownerStart > ownerEnd);

  const loadOwnerUsage = useCallback(async (start: string, end: string) => {
    setOwnerLoading(true);
    setOwnerError("");
    try {
      const res = await getOwnerUsage(undefined, start, end);
      setOwnerData(res);
    } catch (e) {
      setOwnerError(e instanceof Error ? e.message : String(e));
    } finally {
      setOwnerLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ownerStart || !ownerEnd || ownerRangeInvalid) return;
    loadOwnerUsage(ownerStart, ownerEnd);
  }, [ownerStart, ownerEnd, ownerRangeInvalid, loadOwnerUsage]);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const csv = Array.from(files).filter((f) => /\.csv$/i.test(f.name));
    if (csv.length !== files.length) {
      setUploadError("只支持 .csv 文件（amount-*.csv / cost-*.csv）");
    } else {
      setUploadError("");
    }
    setSelected((prev) => [...prev, ...csv]);
  };

  const doUpload = async () => {
    if (selected.length === 0) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError("");
    try {
      const res = await uploadDeepseekFiles(selected);
      setUploadResult(res);
      if (res.status === "ok") {
        setSelected([]);
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUploadError(
        msg === "Failed to fetch"
          ? "网络请求失败（Failed to fetch）：请确认后端服务已启动、浏览器能访问 7601 端口，然后重试；若文件较大请稍等。"
          : msg
      );
    } finally {
      setUploading(false);
    }
  };

  const doRefreshBalance = async () => {
    setRefreshingBal(true);
    setBalMsg("");
    setBalError("");
    try {
      await refreshDeepseekBalance();
      const [bal, tp] = await Promise.all([getDeepseekBalance(), getDeepseekTopups(50)]);
      setBalance(bal);
      setTopups(tp.items);
      setBalMsg("余额已刷新");
    } catch (e) {
      setBalError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshingBal(false);
    }
  };

  const doParseTopup = async () => {
    if (!topupText.trim()) {
      setTopupError("请先粘贴充值订单信息");
      return;
    }
    setParsing(true);
    setTopupMsg("");
    setTopupError("");
    try {
      const res = await parseDeepseekTopups(topupText);
      setTopupMsg(
        res.inserted > 0 ? `成功登记 ${res.inserted} 条充值记录` : "未发现新记录"
      );
      if (res.skipped > 0) {
        setTopupMsg((m) => `${m}，${res.skipped} 条已存在跳过`);
      }
      setTopupText("");
      const [bal, tp] = await Promise.all([getDeepseekBalance(), getDeepseekTopups(50)]);
      setBalance(bal);
      setTopups(tp.items);
    } catch (e) {
      setTopupError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  };

  const trendOption = useMemo<echarts.EChartsOption>(() => {
    const trend = data?.trend ?? [];
    return {
      tooltip: { ...TOOLTIP, trigger: "axis" },
      grid: { left: 50, right: 18, top: 30, bottom: 24 },
      legend: { top: 0, right: 0, textStyle: { color: "var(--text-secondary)", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      xAxis: {
        type: "category",
        data: trend.map((t) => t.date.slice(5)),
        ...AXIS_LIGHT,
        axisLabel: { color: "var(--text-secondary)", fontSize: 10, interval: Math.ceil(trend.length / 15) - 1 },
      },
      yAxis: [
        { type: "value", name: "成本(¥)", ...AXIS_LIGHT, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => `¥${v.toFixed(2)}` } },
        { type: "value", name: "调用", ...AXIS_LIGHT, splitLine: { show: false }, axisLabel: { color: "var(--text-secondary)", fontSize: 10 } },
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
              { offset: 0, color: "rgba(34,211,238,0.28)" },
              { offset: 1, color: "rgba(34,211,238,0.02)" },
            ]),
          },
        },
        {
          name: "调用",
          type: "bar",
          yAxisIndex: 1,
          barWidth: 8,
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
        textStyle: { color: "var(--text-secondary)", fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
      },
      series: [
        {
          name: "模型成本占比",
          type: "pie",
          radius: ["40%", "66%"],
          center: ["34%", "52%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "var(--card-bg)", borderWidth: 2 },
          label: { color: "var(--text-primary)", fontSize: 11, formatter: "{b}\n{d}%" },
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
      xAxis: { type: "value", ...AXIS_LIGHT, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => `¥${v}` } },
      yAxis: {
        type: "category",
        data: items.map((k) => (k.api_key_name.length > 16 ? `${k.api_key_name.slice(0, 16)}…` : k.api_key_name)),
        ...AXIS_LIGHT,
        axisLabel: { color: "var(--text-secondary)", fontSize: 10 },
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
          label: { show: true, position: "right", color: "var(--text-secondary)", fontSize: 10, formatter: (p) => `¥${Number((p as { value?: unknown }).value ?? 0).toFixed(4)}` },
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
      legend: { top: 0, left: 0, type: "scroll", textStyle: { color: "var(--text-secondary)", fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 48, right: 16, top: 30, bottom: 24 },
      xAxis: { type: "category", data: days.map((d) => d.slice(5)), ...AXIS_LIGHT, axisLabel: { color: "var(--text-secondary)", fontSize: 10 } },
      yAxis: { type: "value", ...AXIS_LIGHT, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => `¥${v.toFixed(2)}` } },
      series,
    };
  }, [data]);

  const keyDetailOption = useMemo<echarts.EChartsOption>(() => {
    const daily = keyDetail?.daily ?? [];
    if (!daily.length) return {};
    const colors = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "rgba(34,211,238,0.30)" },
      { offset: 1, color: "rgba(34,211,238,0.02)" },
    ]);
    return {
      tooltip: { ...TOOLTIP, trigger: "axis" },
      grid: { left: 50, right: 52, top: 30, bottom: 24 },
      legend: { top: 0, right: 0, textStyle: { color: "var(--text-secondary)", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      xAxis: { type: "category", data: daily.map((d) => d.date.slice(5)), ...AXIS_LIGHT, axisLabel: { color: "var(--text-secondary)", fontSize: 10, interval: Math.ceil(daily.length / 12) - 1 } },
      yAxis: [
        { type: "value", name: "Tokens", ...AXIS_LIGHT, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => fmtTokens(v) } },
        { type: "value", name: "成本(¥)", ...AXIS_LIGHT, splitLine: { show: false }, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => `¥${v.toFixed(2)}` } },
      ],
      series: [
        {
          name: "Tokens",
          type: "bar",
          barWidth: 8,
          data: daily.map((d) => d.tokens),
          itemStyle: { color: "rgba(59,130,246,0.45)", borderRadius: [3, 3, 0, 0] },
        },
        {
          name: "成本",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 4,
          yAxisIndex: 1,
          data: daily.map((d) => Number(d.cost.toFixed(4))),
          lineStyle: { color: "#22d3ee", width: 2 },
          itemStyle: { color: "#22d3ee" },
          areaStyle: { color: colors },
        },
      ],
    };
  }, [keyDetail]);

  // 各 Key 用量与占比：柱状图（Tokens 柱 + 金额柱，金额柱标注占比）
  const keyUsageOption = useMemo<echarts.EChartsOption>(() => {
    const items = usageData?.items ?? [];
    if (!items.length) return {};
    const names = items.map((k) => k.api_key_name);
    const tokensGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "rgba(59,130,246,0.85)" },
      { offset: 1, color: "rgba(59,130,246,0.15)" },
    ]);
    const costGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "rgba(52,211,153,0.85)" },
      { offset: 1, color: "rgba(52,211,153,0.15)" },
    ]);
    return {
      tooltip: {
        ...TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params];
          const idx = (arr[0] as { dataIndex: number }).dataIndex;
          const it = items[idx];
          if (!it) return "";
          return [
            `<b>${it.api_key_name}</b>`,
            `Tokens：${fmtTokens(it.tokens)}（占比 ${(it.token_ratio * 100).toFixed(1)}%）`,
            `金额：${fmtCNY(it.cost)}（占比 ${(it.cost_ratio * 100).toFixed(1)}%）`,
            `调用：${it.calls.toLocaleString()} 次`,
          ].join("<br/>");
        },
      },
      legend: { top: 0, right: 0, textStyle: { color: "var(--text-secondary)", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 56, right: 56, top: 30, bottom: 56 },
      xAxis: {
        type: "category",
        data: names,
        ...AXIS_LIGHT,
        axisLabel: { color: "var(--text-secondary)", fontSize: 10, interval: 0, rotate: names.length > 4 ? 30 : 0 },
      },
      yAxis: [
        { type: "value", name: "Tokens", ...AXIS_LIGHT, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => fmtTokens(v) } },
        { type: "value", name: "金额(¥)", ...AXIS_LIGHT, splitLine: { show: false }, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => `¥${v.toFixed(2)}` } },
      ],
      series: [
        {
          name: "Tokens",
          type: "bar",
          barWidth: 14,
          data: items.map((k) => k.tokens),
          itemStyle: { color: tokensGradient, borderRadius: [3, 3, 0, 0] },
        },
        {
          name: "金额",
          type: "bar",
          barWidth: 14,
          yAxisIndex: 1,
          data: items.map((k) => Number(k.cost.toFixed(4))),
          itemStyle: { color: costGradient, borderRadius: [3, 3, 0, 0] },
          label: {
            show: true,
            position: "top",
            color: "var(--text-secondary)",
            fontSize: 10,
            formatter: (p) => `${((items[(p as { dataIndex: number }).dataIndex]?.cost_ratio ?? 0) * 100).toFixed(1)}%`,
          },
        },
      ],
    };
  }, [usageData]);

  // 各 Key（归属人员）用量与占比：柱状图（按归属人员聚合，Tokens 柱 + 金额柱，金额柱标注占比）
  const ownerUsageOption = useMemo<echarts.EChartsOption>(() => {
    const items = ownerData?.items ?? [];
    if (!items.length) return {};
    const names = items.map((o) => o.owner);
    const tokensGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "rgba(96,165,250,0.85)" },
      { offset: 1, color: "rgba(96,165,250,0.15)" },
    ]);
    const costGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "rgba(251,191,36,0.85)" },
      { offset: 1, color: "rgba(251,191,36,0.15)" },
    ]);
    return {
      tooltip: {
        ...TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params];
          const idx = (arr[0] as { dataIndex: number }).dataIndex;
          const it = items[idx];
          if (!it) return "";
          const keyList = it.keys.length > 6 ? `${it.keys.slice(0, 6).join("、")} 等 ${it.keys.length} 个` : it.keys.join("、");
          return [
            `<b>${it.owner}</b>`,
            `Tokens：${fmtTokens(it.tokens)}（占比 ${(it.token_ratio * 100).toFixed(1)}%）`,
            `金额：${fmtCNY(it.cost)}（占比 ${(it.cost_ratio * 100).toFixed(1)}%）`,
            `调用：${it.calls.toLocaleString()} 次`,
            `Key（${it.key_count}）：${keyList}`,
          ].join("<br/>");
        },
      },
      legend: { top: 0, right: 0, textStyle: { color: "var(--text-secondary)", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 56, right: 56, top: 30, bottom: 56 },
      xAxis: {
        type: "category",
        data: names,
        ...AXIS_LIGHT,
        axisLabel: { color: "var(--text-secondary)", fontSize: 10, interval: 0, rotate: names.length > 4 ? 30 : 0 },
      },
      yAxis: [
        { type: "value", name: "Tokens", ...AXIS_LIGHT, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => fmtTokens(v) } },
        { type: "value", name: "金额(¥)", ...AXIS_LIGHT, splitLine: { show: false }, axisLabel: { color: "var(--text-secondary)", fontSize: 10, formatter: (v: number) => `¥${v.toFixed(2)}` } },
      ],
      series: [
        {
          name: "Tokens",
          type: "bar",
          barWidth: 14,
          data: items.map((o) => o.tokens),
          itemStyle: { color: tokensGradient, borderRadius: [3, 3, 0, 0] },
        },
        {
          name: "金额",
          type: "bar",
          barWidth: 14,
          yAxisIndex: 1,
          data: items.map((o) => Number(o.cost.toFixed(4))),
          itemStyle: { color: costGradient, borderRadius: [3, 3, 0, 0] },
          label: {
            show: true,
            position: "top",
            color: "var(--text-secondary)",
            fontSize: 10,
            formatter: (p) => `${((items[(p as { dataIndex: number }).dataIndex]?.cost_ratio ?? 0) * 100).toFixed(1)}%`,
          },
        },
      ],
    };
  }, [ownerData]);

  if (loading && !data) {
    return (
      <div className="hzx-card animate-pulse">
        <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-2/3 mb-4" />
        <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-1/2" />
      </div>
    );
  }

  const stats = [
    { label: "总调用次数", value: (data?.calls ?? 0).toLocaleString(), sub: `数据范围 ${data?.date_range.min || "-"} ~ ${data?.date_range.max || "-"}`, color: "var(--accent-blue)" },
    { label: "总 Tokens", value: fmtTokens(data?.tokens ?? 0), sub: `输入 ${fmtTokens(data?.input ?? 0)} / 输出 ${fmtTokens(data?.output ?? 0)}`, color: "var(--text-primary)" },
    {
      label: "总成本",
      value: fmtCNY(data?.totalCost ?? 0),
      sub: (
        <>
          <p>币种 {data?.currency || "CNY"} · 已上传 {data?.imports ?? 0} 个文件</p>
          <p className="mt-0.5" style={{ color: "var(--accent-green)" }}>模型实际用量：{fmtCNY(data?.balance?.actual_usage ?? 0)} · 为目前总消耗</p>
        </>
      ),
      color: "var(--accent-green)",
    },
    { label: "最新数据日期", value: data?.latest_date || "-", sub: data?.latest_date ? `${fmtCNY(data?.latest_cost ?? 0)} · ${(data?.latest_calls ?? 0).toLocaleString()} 次调用` : "等待上传数据", color: "var(--accent-orange)" },
  ];

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="hzx-card" style={{ borderColor: "var(--accent-red)" }}>
          <p className="text-sm" style={{ color: "var(--accent-red)" }}>数据加载失败：{loadError}</p>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} sub={s.sub} color={s.color} />
        ))}
      </div>

      {/* 账户余额与充值 */}
      <div className="hzx-card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            💳 DeepSeek 账户余额
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              每小时自动刷新{balance?.fetched_at ? ` · 上次更新 ${balance.fetched_at}` : ""}
            </span>
            <button onClick={doRefreshBalance} disabled={refreshingBal} className="hzx-btn !py-1.5 !px-3 !text-xs">
              {refreshingBal ? "刷新中…" : "立即刷新余额"}
            </button>
          </div>
        </div>

        {!balance?.configured ? (
          <p className="text-sm" style={{ color: "var(--accent-orange)" }}>
            尚未配置 DeepSeek API Key，无法获取账户余额。请前往{" "}
            <Link href="/settings" className="underline" style={{ color: "var(--accent-blue)" }}>设置页</Link>{" "}
            填写后，系统将每小时自动拉取余额快照并测算每日实际用量。
          </p>
        ) : balance?.total_balance === null ? (
          <p className="text-sm" style={{ color: "var(--accent-orange)" }}>
            暂无余额快照，点击右上角"立即刷新余额"获取当前余额。
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { label: "当前余额", value: fmtCNY(balance?.total_balance ?? 0), color: "var(--accent-green)", sub: `充值余额 ${fmtCNY(balance?.topped_up_balance ?? 0)}` },
              { label: "今日实际用量", value: fmtCNY(balance?.today_usage ?? 0), color: "var(--accent-blue)", sub: `今日充值 ${fmtCNY(balance?.today_topup ?? 0)}` },
              { label: "实际总消耗", value: fmtCNY(balance?.actual_usage ?? 0), color: "var(--accent-orange)", sub: "即目前总消耗" },
              { label: "累计充值", value: fmtCNY(balance?.total_topups ?? 0), color: "#a78bfa", sub: `赠金余额 ${fmtCNY(balance?.granted_balance ?? 0)}` },
              { label: "账户状态", value: balance?.is_available ? "可用" : "不可用", color: balance?.is_available ? "var(--accent-green)" : "var(--accent-red)", sub: "余额可供 API 调用" },
              { label: "币种", value: balance?.currency || "CNY", color: "var(--text-primary)", sub: balance?.currency === "CNY" ? "人民币" : "外币" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg px-3 py-2.5" style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-tertiary)" }}>{s.sub}</p>
              </div>
            ))}
          </div>
        )}

        {balMsg && <p className="text-xs mt-3" style={{ color: "var(--accent-green)" }}>{balMsg}</p>}
        {balError && <p className="text-xs mt-3" style={{ color: "var(--accent-red)" }}>刷新失败：{balError}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
          {/* 充值登记 */}
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
              💰 充值登记（粘贴订单信息自动识别）
            </p>
            <textarea
              value={topupText}
              onChange={(e) => setTopupText(e.target.value)}
              rows={5}
              placeholder={"粘贴充值订单信息，自动识别并登记。支持如下格式（复制 DeepSeek 平台的订单列表）：\n订单编号\t状态\t金额\t支付方式\t创建时间\n1787627033792UkebbjnFrnFaejb\t成功\t¥600\t支付宝\t2026-08-25 11:03:54"}
              className="w-full rounded-md px-3 py-2 text-xs leading-relaxed resize-y"
              style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
            />
            <div className="flex items-center gap-3 mt-2">
              <button onClick={doParseTopup} disabled={parsing} className="hzx-btn !py-1.5 !px-4 !text-xs">
                {parsing ? "解析中…" : "解析并登记"}
              </button>
              <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                按订单编号去重，重复粘贴不会重复入账
              </span>
            </div>
            {topupMsg && <p className="text-xs mt-2" style={{ color: "var(--accent-green)" }}>{topupMsg}</p>}
            {topupError && <p className="text-xs mt-2" style={{ color: "var(--accent-red)" }}>{topupError}</p>}
            {topups.length > 0 && (
              <div className="mt-3 overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0" style={{ backgroundColor: "var(--card-bg)" }}>
                    <tr style={{ color: "var(--text-tertiary)" }}>
                      <th className="text-left py-1 pr-2 font-medium">金额</th>
                      <th className="text-left py-1 pr-2 font-medium">方式</th>
                      <th className="text-left py-1 pr-2 font-medium">状态</th>
                      <th className="text-left py-1 font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topups.slice(0, 8).map((t) => (
                      <tr key={t.id} className="border-t" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
                        <td className="py-1.5 pr-2 tabular-nums" style={{ color: t.status === "成功" ? "var(--accent-green)" : "var(--accent-red)" }}>{fmtCNY(t.amount)}</td>
                        <td className="py-1.5 pr-2">{t.pay_method || "-"}</td>
                        <td className="py-1.5 pr-2">{t.status || "-"}</td>
                        <td className="py-1.5 tabular-nums">{t.created_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 每日实际用量 */}
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
              📊 每日实际用量（近 {Math.min(balance?.daily_usage?.length ?? 0, 7)} 天）
            </p>
            {!balance?.daily_usage?.length ? (
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>暂无余额快照数据，等待每小时自动拉取。</p>
            ) : (
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0" style={{ backgroundColor: "var(--card-bg)" }}>
                    <tr style={{ color: "var(--text-tertiary)" }}>
                      <th className="text-left py-1 pr-2 font-medium">日期</th>
                      <th className="text-right py-1 pr-2 font-medium">日初余额</th>
                      <th className="text-right py-1 pr-2 font-medium">日末余额</th>
                      <th className="text-right py-1 pr-2 font-medium">当日充值</th>
                      <th className="text-right py-1 font-medium">实际用量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balance.daily_usage.slice(-7).reverse().map((d) => (
                      <tr key={d.date} className="border-t" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
                        <td className="py-1.5 pr-2 tabular-nums">{d.date}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{fmtCNY(d.start)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{fmtCNY(d.end)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums" style={{ color: "var(--accent-green)" }}>{d.topups > 0 ? `+${fmtCNY(d.topups)}` : "-"}</td>
                        <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--accent-blue)" }}>{fmtCNY(d.usage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 上传卡片 */}
      <div className="hzx-card">
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          📤 上传用量文件
        </h3>
        <p className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>
          支持 amount-*.csv（用量明细）与 cost-*.csv（成本），可一次多选或拖拽上传；上传后自动覆盖并补充对应日期的模型用量。
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors"
          style={{
            borderColor: dragOver ? "var(--accent-blue)" : "var(--border-color)",
            backgroundColor: dragOver ? "var(--hover-bg)" : "transparent",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />
          <p className="text-3xl mb-2">📂</p>
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            点击选择文件，或将 CSV 拖拽到此处
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            固定格式：amount-*.csv / cost-*.csv（表头自动识别）
          </p>
        </div>

        {selected.length > 0 && (
          <div className="mt-3">
            <p className="text-xs mb-1 font-medium" style={{ color: "var(--text-secondary)" }}>待上传文件：</p>
            <ul className="space-y-1">
              {selected.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs rounded-md px-3 py-1.5" style={{ backgroundColor: "var(--bg-secondary)" }}>
                  <span className="truncate" style={{ color: "var(--text-primary)" }}>{f.name}</span>
                  <span style={{ color: "var(--text-tertiary)" }}>{(f.size / 1024).toFixed(1)} KB</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3 mt-3">
              <button onClick={doUpload} disabled={uploading} className="hzx-btn !py-2 !px-5 !text-sm">
                {uploading ? "上传解析中…" : `上传 ${selected.length} 个文件`}
              </button>
              <button
                onClick={() => setSelected([])}
                disabled={uploading}
                className="px-3 py-2 rounded-md text-sm"
                style={{ backgroundColor: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
              >
                清空
              </button>
            </div>
          </div>
        )}

        {uploading && (
          <p className="text-xs mt-3 flex items-center gap-2" style={{ color: "var(--accent-blue)" }}>
            <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
            正在解析并写入数据库，请稍候…
          </p>
        )}
        {uploadError && (
          <p className="text-xs mt-3" style={{ color: "var(--accent-red)" }}>上传失败：{uploadError}</p>
        )}
        {uploadResult && (
          <div className="mt-3 rounded-md px-3 py-2 text-xs" style={{ backgroundColor: uploadResult.status === "ok" ? "rgba(52,211,153,0.12)" : "rgba(248,81,73,0.12)" }}>
            <p className="font-medium mb-1" style={{ color: uploadResult.status === "ok" ? "var(--accent-green)" : "var(--accent-red)" }}>
              {uploadResult.status === "ok" ? `上传成功：${uploadResult.ok_count} 个文件，共 ${uploadResult.total_rows} 行数据` : "部分文件上传失败"}
            </p>
            <ul className="space-y-0.5">
              {uploadResult.files.map((f) => (
                <li key={f.filename} style={{ color: "var(--text-secondary)" }}>
                  {f.filename} → {f.status === "ok" ? `${f.kind === "amount" ? "用量" : "成本"} ${f.rows} 行（${f.date_min} ~ ${f.date_max}，覆盖 ${f.deleted} 行）` : `失败：${f.message || "未知错误"}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {imports.length > 0 && (
          <div className="mt-4">
            <p className="text-xs mb-1 font-medium" style={{ color: "var(--text-secondary)" }}>最近上传记录：</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--text-tertiary)" }}>
                    <th className="text-left py-1 pr-3 font-medium">文件名</th>
                    <th className="text-left py-1 pr-3 font-medium">类型</th>
                    <th className="text-right py-1 pr-3 font-medium">行数</th>
                    <th className="text-left py-1 pr-3 font-medium">日期范围</th>
                    <th className="text-left py-1 font-medium">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.slice(0, 6).map((r) => (
                    <tr key={r.id} className="border-t" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
                      <td className="py-1.5 pr-3 truncate max-w-40">{r.filename}</td>
                      <td className="py-1.5 pr-3">{r.kind === "amount" ? "用量" : "成本"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.rows}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{r.date_min} ~ {r.date_max}</td>
                      <td className="py-1.5 tabular-nums">{r.imported_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartPanel title="📈 每日成本与调用趋势" extra={<Link href="/deepseek/screen" className="text-xs" style={{ color: "var(--accent-blue)" }}>查看可视化大屏 →</Link>}>
          <EChart option={trendOption} height={280} />
        </ChartPanel>
        <ChartPanel title="🥧 模型成本占比">
          <EChart option={modelPieOption} height={280} />
        </ChartPanel>
        <ChartPanel title="🔑 API Key 成本排行 TOP 10">
          <EChart option={keyBarOption} height={280} />
        </ChartPanel>
        <ChartPanel title="🧠 模型每日成本走势">
          <EChart option={modelTrendOption} height={280} />
        </ChartPanel>
      </div>

      {/* 详细使用卡片：选定 Key + 时间维度 */}
      <div className="hzx-card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            🔍 详细使用情况（按 Key 与时间维度）
          </h3>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>选择 Key：</label>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="rounded-md px-3 py-1.5 text-xs"
              style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
            >
              <option value="__all__">全部 Key（总计）</option>
              {data?.api_key_rank?.map((k) => (
                <option key={k.api_key_name} value={k.api_key_name}>{k.api_key_name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 日历日期区间选择 */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>时间：</label>
          <input
            type="date"
            value={keyStart}
            max={keyEnd || undefined}
            onChange={(e) => setKeyStart(e.target.value)}
            className="rounded-md px-2 py-1.5 text-xs"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)", colorScheme: "dark" }}
          />
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>至</span>
          <input
            type="date"
            value={keyEnd}
            min={keyStart || undefined}
            onChange={(e) => setKeyEnd(e.target.value)}
            className="rounded-md px-2 py-1.5 text-xs"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)", colorScheme: "dark" }}
          />
          <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--border-color)" }} />
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>快捷：</span>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setPreset(d)}
              className="rounded-md px-2 py-1 text-[11px]"
              style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}
            >
              近 {d} 天
            </button>
          ))}
        </div>
        {rangeInvalid && (
          <p className="text-xs mb-3" style={{ color: "var(--accent-red)" }}>开始日期不能晚于结束日期，请重新选择。</p>
        )}

        {keyDetailError && (
          <p className="text-xs mb-3" style={{ color: "var(--accent-red)" }}>详细数据加载失败：{keyDetailError}</p>
        )}
        {keyDetailLoading && !keyDetail ? (
          <p className="text-xs py-4 text-center" style={{ color: "var(--text-tertiary)" }}>加载中…</p>
        ) : keyDetail ? (
          <>
            {/* 汇总统计 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {[
                { label: "Token 总用量", value: fmtTokens(keyDetail.totals.tokens), color: "var(--accent-blue)", sub: `输入 ${fmtTokens(keyDetail.totals.input)} / 输出 ${fmtTokens(keyDetail.totals.output)}` },
                { label: "消耗总金额", value: fmtCNY(keyDetail.totals.cost), color: "var(--accent-green)", sub: `${keyDetail.date_range.start} ~ ${keyDetail.date_range.end}` },
                { label: "调用总次数", value: keyDetail.totals.calls.toLocaleString(), color: "var(--accent-orange)", sub: `缓存命中 ${fmtTokens(keyDetail.totals.cache_hit)} · 未命中 ${fmtTokens(keyDetail.totals.cache_miss)}` },
              ].map((s) => (
                <div key={s.label} className="rounded-lg px-4 py-3" style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)" }}>
                  <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
                  <p className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-tertiary)" }}>{s.sub}</p>
                </div>
              ))}
            </div>

            {/* 趋势图表 */}
            <EChart option={keyDetailOption} height={280} />

            {/* 每日明细表 */}
            <div className="mt-4 overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ backgroundColor: "var(--card-bg)" }}>
                  <tr style={{ color: "var(--text-tertiary)" }}>
                    <th className="text-left py-1 pr-2 font-medium">日期</th>
                    <th className="text-right py-1 pr-2 font-medium">调用</th>
                    <th className="text-right py-1 pr-2 font-medium">Tokens</th>
                    <th className="text-right py-1 pr-2 font-medium">输入</th>
                    <th className="text-right py-1 pr-2 font-medium">输出</th>
                    <th className="text-right py-1 font-medium">成本</th>
                  </tr>
                </thead>
                <tbody>
                  {keyDetail.daily.slice().reverse().map((d) => (
                    <tr key={d.date} className="border-t" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
                      <td className="py-1.5 pr-2 tabular-nums">{d.date}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{d.calls.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtTokens(d.tokens)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtTokens(d.input)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtTokens(d.output)}</td>
                      <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--accent-blue)" }}>{fmtCNY(d.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-xs py-4 text-center" style={{ color: "var(--text-tertiary)" }}>请选择 Key 后查看详细使用情况。</p>
        )}
        {keyDetail && (
          <p className="text-[11px] mt-3" style={{ color: "var(--text-tertiary)" }}>
            {selectedKey === "__all__" ? (
              <>全部 API Key 汇总 · 成本为估算值（基于金额文件 price × amount）</>
            ) : (
              <>API Key（仅展示前后段）：{keyDetail.api_key.slice(0, 6)}…{keyDetail.api_key.slice(-4)} · 成本为估算值（基于金额文件 price × amount）</>
            )}
          </p>
        )}
      </div>

      {/* 各 Key 用量与占比：仅按时间维度 */}
      <div className="hzx-card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            📊 各 Key 用量与占比（按时间维度）
          </h3>
        </div>

        {/* 时间区间选择 */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>时间：</label>
          <input
            type="date"
            value={usageStart}
            max={usageEnd || undefined}
            onChange={(e) => setUsageStart(e.target.value)}
            className="rounded-md px-2 py-1.5 text-xs"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)", colorScheme: "dark" }}
          />
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>至</span>
          <input
            type="date"
            value={usageEnd}
            min={usageStart || undefined}
            onChange={(e) => setUsageEnd(e.target.value)}
            className="rounded-md px-2 py-1.5 text-xs"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)", colorScheme: "dark" }}
          />
          <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--border-color)" }} />
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>快捷：</span>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setUsagePreset(d)}
              className="rounded-md px-2 py-1 text-[11px]"
              style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}
            >
              近 {d} 天
            </button>
          ))}
        </div>
        {usageRangeInvalid && (
          <p className="text-xs mb-3" style={{ color: "var(--accent-red)" }}>开始日期不能晚于结束日期，请重新选择。</p>
        )}

        {usageError && (
          <p className="text-xs mb-3" style={{ color: "var(--accent-red)" }}>数据加载失败：{usageError}</p>
        )}
        {usageLoading && !usageData ? (
          <p className="text-xs py-4 text-center" style={{ color: "var(--text-tertiary)" }}>加载中…</p>
        ) : usageData ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {[
                { label: "区间 Token 总量", value: fmtTokens(usageData.totals.tokens), color: "var(--accent-blue)", sub: `${usageData.date_range.start} ~ ${usageData.date_range.end}` },
                { label: "区间消耗金额", value: fmtCNY(usageData.totals.cost), color: "var(--accent-green)", sub: `共 ${usageData.items.length} 个 Key` },
                { label: "区间调用总量", value: usageData.totals.calls.toLocaleString(), color: "var(--accent-orange)", sub: "按 Key 聚合" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg px-4 py-3" style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)" }}>
                  <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
                  <p className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-tertiary)" }}>{s.sub}</p>
                </div>
              ))}
            </div>

            {usageData.items.length ? (
              <EChart option={keyUsageOption} height={320} />
            ) : (
              <p className="text-xs py-8 text-center" style={{ color: "var(--text-tertiary)" }}>该时间区间内暂无用量数据。</p>
            )}

            <div className="mt-4 overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ backgroundColor: "var(--card-bg)" }}>
                  <tr style={{ color: "var(--text-tertiary)" }}>
                    <th className="text-left py-1 pr-2 font-medium">API Key</th>
                    <th className="text-right py-1 pr-2 font-medium">调用</th>
                    <th className="text-right py-1 pr-2 font-medium">Tokens</th>
                    <th className="text-right py-1 pr-2 font-medium">金额</th>
                    <th className="text-right py-1 font-medium">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {usageData.items.map((k) => (
                    <tr key={k.api_key_name} className="border-t" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
                      <td className="py-1.5 pr-2">{k.api_key_name}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{k.calls.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtTokens(k.tokens)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums" style={{ color: "var(--accent-green)" }}>{fmtCNY(k.cost)}</td>
                      <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--accent-blue)" }}>{(k.cost_ratio * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] mt-3" style={{ color: "var(--text-tertiary)" }}>
              占比按金额计算（表中「占比」列）；柱状图双轴展示各 Key 的 Tokens 与金额，金额柱顶标注其金额占比 · 金额为估算值（基于金额文件 price × amount）。
            </p>
          </>
        ) : (
          <p className="text-xs py-4 text-center" style={{ color: "var(--text-tertiary)" }}>请选择时间区间后查看各 Key 用量。</p>
        )}
      </div>

      {/* 各 Key（归属人员）用量与占比：仅按时间维度 */}
      <div className="hzx-card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            📊 各 Key（归属人员）用量与占比（按时间维度）
          </h3>
          <Link href="/key-owners" className="text-xs" style={{ color: "var(--accent-blue)" }}>管理 Key 归属人员 →</Link>
        </div>

        {/* 时间区间选择 */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>时间：</label>
          <input
            type="date"
            value={ownerStart}
            max={ownerEnd || undefined}
            onChange={(e) => setOwnerStart(e.target.value)}
            className="rounded-md px-2 py-1.5 text-xs"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)", colorScheme: "dark" }}
          />
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>至</span>
          <input
            type="date"
            value={ownerEnd}
            min={ownerStart || undefined}
            onChange={(e) => setOwnerEnd(e.target.value)}
            className="rounded-md px-2 py-1.5 text-xs"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)", colorScheme: "dark" }}
          />
          <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--border-color)" }} />
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>快捷：</span>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setOwnerPreset(d)}
              className="rounded-md px-2 py-1 text-[11px]"
              style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}
            >
              近 {d} 天
            </button>
          ))}
        </div>
        {ownerRangeInvalid && (
          <p className="text-xs mb-3" style={{ color: "var(--accent-red)" }}>开始日期不能晚于结束日期，请重新选择。</p>
        )}

        {ownerError && (
          <p className="text-xs mb-3" style={{ color: "var(--accent-red)" }}>数据加载失败：{ownerError}</p>
        )}
        {ownerLoading && !ownerData ? (
          <p className="text-xs py-4 text-center" style={{ color: "var(--text-tertiary)" }}>加载中…</p>
        ) : ownerData ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {[
                { label: "区间 Token 总量", value: fmtTokens(ownerData.totals.tokens), color: "var(--accent-blue)", sub: `${ownerData.date_range.start} ~ ${ownerData.date_range.end}` },
                { label: "区间消耗金额", value: fmtCNY(ownerData.totals.cost), color: "var(--accent-green)", sub: `共 ${ownerData.items.length} 个归属人员` },
                { label: "区间调用总量", value: ownerData.totals.calls.toLocaleString(), color: "var(--accent-orange)", sub: "按归属人员聚合" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg px-4 py-3" style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)" }}>
                  <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
                  <p className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-tertiary)" }}>{s.sub}</p>
                </div>
              ))}
            </div>

            {ownerData.items.length ? (
              <EChart option={ownerUsageOption} height={320} />
            ) : (
              <p className="text-xs py-8 text-center" style={{ color: "var(--text-tertiary)" }}>该时间区间内暂无用量数据。</p>
            )}

            <div className="mt-4 overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ backgroundColor: "var(--card-bg)" }}>
                  <tr style={{ color: "var(--text-tertiary)" }}>
                    <th className="text-left py-1 pr-2 font-medium">归属人员</th>
                    <th className="text-right py-1 pr-2 font-medium">Key 数</th>
                    <th className="text-right py-1 pr-2 font-medium">调用</th>
                    <th className="text-right py-1 pr-2 font-medium">Tokens</th>
                    <th className="text-right py-1 pr-2 font-medium">金额</th>
                    <th className="text-right py-1 font-medium">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {ownerData.items.map((o) => (
                    <tr key={o.owner} className="border-t" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
                      <td className="py-1.5 pr-2">
                        <span style={{ color: "var(--text-primary)" }}>{o.owner}</span>
                        {o.keys.length > 0 && (
                          <span className="ml-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                            {o.keys.length > 4 ? `${o.keys.slice(0, 4).join("、")} 等 ${o.keys.length} 个` : o.keys.join("、")}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{o.key_count}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{o.calls.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtTokens(o.tokens)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums" style={{ color: "var(--accent-green)" }}>{fmtCNY(o.cost)}</td>
                      <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--accent-blue)" }}>{(o.cost_ratio * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] mt-3" style={{ color: "var(--text-tertiary)" }}>
              按归属人员聚合其名下全部 Key 的用量；占比按金额计算（表中「占比」列）。未登记归属的 Key 归入「未归属」，
              可在 <Link href="/key-owners" style={{ color: "var(--accent-blue)" }}>key归属人员</Link> 页面维护 · 金额为估算值（基于金额文件 price × amount）。
            </p>
          </>
        ) : (
          <p className="text-xs py-4 text-center" style={{ color: "var(--text-tertiary)" }}>请选择时间区间后查看各归属人员用量。</p>
        )}
      </div>

      <p className="text-xs text-center" style={{ color: "var(--text-tertiary)" }}>
        数据来源：账号维度 amount/cost CSV 文件上传，与 OpenClaw 机器维度用量相互独立。
      </p>
    </div>
  );
}
