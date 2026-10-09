"use client";

import { useState } from "react";
import { requestTraySync } from "@/lib/api";

/**
 * 托盘一键同步：向服务器下发同步指令，所有在线的 OpenClaw 托盘将在下一轮询周期各同步一次。
 */
export default function SyncAllButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  const sync = async () => {
    if (loading) return;
    setLoading(true);
    setMsg("");
    setOk(false);
    try {
      await requestTraySync();
      setMsg("已下发同步指令，在线托盘将在几秒内同步");
      setOk(true);
    } catch (e) {
      setMsg(`下发失败: ${e instanceof Error ? e.message : String(e)}`);
      setOk(false);
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(""), 4000);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={sync} disabled={loading} className="hzx-btn !py-1.5 !px-3 !text-xs">
        {loading ? "下发中..." : "🔄 同步全部托盘"}
      </button>
      {msg && (
        <span className="text-[11px]" style={{ color: ok ? "var(--accent-green)" : "var(--accent-red)" }}>
          {msg}
        </span>
      )}
    </div>
  );
}
