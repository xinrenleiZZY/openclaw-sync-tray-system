"use client";

import { useCallback, useEffect, useState } from "react";
import { getTraySyncStatus, type TraySyncStatus } from "@/lib/api";

/**
 * 在线托盘版本面板：展示各在线托盘上报的版本号，便于确认升级情况。
 * 每 15 秒拉取一次 /api/tray/sync/status。
 */
export default function TrayVersionPanel() {
  const [data, setData] = useState<TraySyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getTraySyncStatus();
      setData(res);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const machines = data?.machines ?? [];
  const onlineCount = machines.length;
  const latestVersion = useMemoLatest(machines, data);

  // 版本分布统计
  const versionMap = new Map<string, number>();
  for (const m of machines) {
    const v = data?.versions[m] || "未知";
    versionMap.set(v, (versionMap.get(v) || 0) + 1);
  }
  const versionRows = Array.from(versionMap.entries()).sort((a, b) =>
    b[1] - a[1]
  );

  return (
    <div className="hzx-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">🖥️ 在线托盘</span>
          <span
            className="px-2 py-0.5 rounded text-xs"
            style={{ background: "var(--accent-green-soft)", color: "var(--accent-green)" }}
          >
            {onlineCount} 台
          </span>
          {latestVersion && (
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              最新 {latestVersion}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs" style={{ color: "var(--accent-red)" }}>
              加载失败
            </span>
          )}
          {loading && (
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              刷新中...
            </span>
          )}
          <button
            className="hzx-btn !py-1 !px-2.5 !text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : "详情"}
          </button>
        </div>
      </div>

      {/* 版本分布概览 */}
      {!loading && machines.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {versionRows.slice(0, 3).map(([ver, count]) => (
            <div key={ver} className="flex items-center gap-2 text-xs">
              <span
                className="px-1.5 py-0.5 rounded"
                style={{ background: "var(--fill-soft)", fontFamily: "monospace" }}
              >
                v{ver}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>
                {count} 台
              </span>
              <div className="flex-1 h-1.5 rounded overflow-hidden" style={{ background: "var(--fill-soft)" }}>
                <div
                  className="h-full rounded"
                  style={{
                    width: `${Math.round((count / machines.length) * 100)}%`,
                    background: "var(--accent-green)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {machines.length === 0 && !loading && (
        <div className="mt-3 text-xs" style={{ color: "var(--text-tertiary)" }}>
          暂无在线托盘，或托盘尚未上报版本。
        </div>
      )}

      {/* 详情：各机器版本列表 */}
      {expanded && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {machines.map((m) => (
              <div
                key={m}
                className="flex items-center justify-between gap-2 text-xs py-1"
              >
                <span className="truncate">{m}</span>
                <code
                  className="px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: "var(--fill-soft)" }}
                >
                  v{data?.versions[m] || "未知"}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 计算最新（最大）版本号用于概览展示
function useMemoLatest(
  machines: string[],
  data: TraySyncStatus | null
): string | null {
  let best: { v: string; score: number[] } | null = null;
  for (const m of machines) {
    const raw = data?.versions[m] || "";
    const v = raw.replace(/^v/i, "");
    const parts = v.split(".").map((p) => parseInt(p, 10) || 0);
    if (!best || (parts.length ? compareArr(parts, best.score) > 0 : v > best.v)) {
      best = { v: raw, score: parts };
    }
  }
  return best ? best.v || null : null;
}

function compareArr(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
