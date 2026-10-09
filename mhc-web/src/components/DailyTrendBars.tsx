"use client";

import { useEffect, useState } from "react";
import { clientFetch } from "@/lib/api";
import { fmtCost } from "@/lib/format";
import type { Overview } from "@/lib/api";

const RANGES = [7, 14, 30] as const;
type Scope = "deepseek" | "all";

export default function DailyTrendBars() {
  const [days, setDays] = useState<number>(7);
  const [scope, setScope] = useState<Scope>("deepseek");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    clientFetch<Overview>(`/api/usage/overview?days=${days}&scope=${scope}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, scope]);

  const trend = data?.trend ?? [];
  const max = Math.max(...trend.map((t) => t.cost), 0.0001);

  return (
    <div className="hzx-card flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 shrink-0 flex-wrap gap-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          📈 近 {days} 天成本趋势
        </h3>
        <div className="flex items-center gap-1 flex-wrap">
          <div className="flex items-center gap-1 rounded-md p-0.5" style={{ backgroundColor: "var(--bg-secondary)" }}>
            {(["deepseek", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className="px-2 py-1 rounded text-xs transition-colors whitespace-nowrap"
                style={{
                  backgroundColor: scope === s ? "var(--card-bg)" : "transparent",
                  color: scope === s ? "var(--text-primary)" : "var(--text-tertiary)",
                  boxShadow: scope === s ? "var(--card-shadow)" : "none",
                  fontWeight: scope === s ? 600 : 400,
                }}
              >
                {s === "deepseek" ? "仅Deepseek" : "全部"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-md p-0.5" style={{ backgroundColor: "var(--bg-secondary)" }}>
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                className="px-2 py-1 rounded text-xs transition-colors"
                style={{
                  backgroundColor: days === r ? "var(--card-bg)" : "transparent",
                  color: days === r ? "var(--text-primary)" : "var(--text-tertiary)",
                  boxShadow: days === r ? "var(--card-shadow)" : "none",
                  fontWeight: days === r ? 600 : 400,
                }}
              >
                {r}天
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>加载中…</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs" style={{ color: "var(--accent-red)" }}>加载失败：{error}</p>
        </div>
      ) : trend.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>近 {days} 天暂无数据</p>
        </div>
      ) : (
        <div className="flex-1 flex items-end pt-2 min-h-[200px] overflow-hidden" style={{ gap: days >= 14 ? 2 : 8 }}>
          {trend.map((t, i) => (
            <div key={t.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end min-w-0">
              <span className="text-[9px] leading-none max-w-full truncate" style={{ color: "var(--text-tertiary)" }}>
                {t.cost > 0 ? fmtCost(t.cost) : ""}
              </span>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max((t.cost / max) * 100, 2)}%`,
                  backgroundColor: t.cost > 0 ? "var(--endspace-accent)" : "var(--bg-tertiary)",
                  minHeight: t.cost > 0 ? 8 : 4,
                }}
                title={`${t.date}: ${t.calls} 次调用 · ${fmtCost(t.cost)}`}
              />
              <span
                className={`text-[9px] leading-none max-w-full truncate ${days >= 14 && i % 2 === 1 ? "invisible" : ""}`}
                style={{ color: "var(--text-tertiary)" }}
              >
                {t.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs mt-2 shrink-0 text-center" style={{ color: "var(--text-tertiary)" }}>
        柱高按当日成本占比（悬停查看明细）
      </p>
    </div>
  );
}
