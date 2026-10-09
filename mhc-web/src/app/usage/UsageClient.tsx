"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAgents, getDays, getMachines, getModels } from "@/lib/api";
import { fmtCost, fmtTokens } from "@/lib/format";
import type { GroupStat } from "@/lib/api";

const DAY_OPTIONS = [
  { value: "7", label: "最近 7 天" },
  { value: "30", label: "最近 30 天" },
  { value: "90", label: "最近 90 天" },
  { value: "180", label: "最近 180 天" },
  { value: "365", label: "最近 365 天" },
];

interface GroupData {
  agents: GroupStat[];
  models: GroupStat[];
  days: GroupStat[];
}

function GroupTable({ title, items, accent }: { title: string; items: GroupStat[]; accent: string }) {
  return (
    <div className="hzx-card">
      <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
        {title}
        <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-tertiary)" }}>{items.length} 项</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>
          该查询范围内暂无数据
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--bg-secondary)" }}>
                <th className="text-left px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>名称</th>
                <th className="text-right px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>调用</th>
                <th className="text-right px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>输入</th>
                <th className="text-right px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>输出</th>
                <th className="text-right px-3 py-2 font-medium text-xs" style={{ color: "var(--text-secondary)" }}>成本</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 100).map((it) => (
                <tr
                  key={it.name}
                  className="border-t text-xs [&:hover]:bg-[var(--hover-bg)]"
                  style={{ borderColor: "var(--border-color)" }}
                >
                  <td className="px-3 py-2 font-medium truncate max-w-40" style={{ color: accent }}>
                    {it.name}
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--text-primary)" }}>{it.calls.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{fmtTokens(it.input)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{fmtTokens(it.output)}</td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ color: "var(--accent-green)" }}>{fmtCost(it.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function UsageClient({
  initialMachine,
  initialDays,
}: {
  initialMachine: string;
  initialDays?: number;
}) {
  const [machine, setMachine] = useState(initialMachine);
  const [days, setDays] = useState(initialDays ? String(initialDays) : "30");
  const [machines, setMachines] = useState<string[]>([]);
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reqId = useRef(0);

  const search = useCallback(async (m: string, d: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError("");
    const daysNum = Number(d);
    try {
      const [agents, models, daysRes] = await Promise.all([
        getAgents(m || undefined, daysNum),
        getModels(m || undefined, daysNum),
        getDays(m || undefined, daysNum),
      ]);
      if (reqId.current !== id) return;
      setData({ agents: agents.items, models: models.items, days: daysRes.items });
    } catch (e) {
      if (reqId.current !== id) return;
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    getMachines()
      .then((r) => setMachines(r.machines.map((m) => m.name)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    search(machine, days);
  }, [search, machine, days]);

  const daysNum = Number(days);
  const start = new Date();
  start.setDate(start.getDate() - (daysNum - 1));
  const rangeText = `最近 ${daysNum} 天（${start.toISOString().slice(0, 10)} ~ ${new Date().toISOString().slice(0, 10)}）`;

  return (
    <div className="space-y-6">
      {/* 筛选栏 */}
      <div className="hzx-card">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            className="rounded-md px-3 py-2 text-sm"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
          >
            <option value="">全部机器</option>
            {machines.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="rounded-md px-3 py-2 text-sm"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
          >
            {DAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => search(machine, days)}
            disabled={loading}
            className="hzx-btn !py-2 !px-4 !text-sm"
          >
            {loading ? "搜索中…" : "搜索"}
          </button>
          {loading && (
            <span className="flex items-center gap-2 text-xs" style={{ color: "var(--accent-blue)" }}>
              <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              正在查询 {rangeText}
            </span>
          )}
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
          当前查询范围：{machine ? `机器 ${machine}` : "全部机器"} · {rangeText}
        </p>
      </div>

      {error && (
        <div className="hzx-card" style={{ borderColor: "var(--accent-red)" }}>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--accent-red)" }}>查询失败</p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            请求后端接口时出错：{error}。请确认后端服务（默认 7601 端口）已启动，然后重试。
          </p>
        </div>
      )}

      {!error && data && data.agents.length === 0 && data.models.length === 0 && data.days.length === 0 && (
        <div className="hzx-card">
          <p className="text-sm font-medium mb-1" style={{ color: "var(--accent-orange)" }}>未查询到数据</p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            在 {rangeText} 内没有找到用量记录。可能原因：该机器在所选天数内未上报数据；所选时间范围早于数据开始日期；或用量数据尚未同步。
            可尝试缩短天数、切换机器，或等待机器推送后再查询。
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <GroupTable title="🤖 按 Agent" items={data?.agents ?? []} accent="var(--accent-blue)" />
        <GroupTable title="🧠 按模型" items={data?.models ?? []} accent="var(--accent-orange)" />
        <GroupTable title="📅 按日期" items={data?.days ?? []} accent="var(--accent-green)" />
      </div>
    </div>
  );
}
