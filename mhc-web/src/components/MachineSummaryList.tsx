import Link from "next/link";
import { getMachines } from "@/lib/api";
import { fmtTokens, fmtCost } from "@/lib/format";

export default async function MachineSummaryList() {
  const data = await getMachines().catch(() => null);
  if (!data || data.machines.length === 0) {
    return (
      <div className="hzx-card">
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          🖥️ 接入机器
        </h3>
        <p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>
          暂无机器上报数据
        </p>
      </div>
    );
  }

  return (
    <div className="hzx-card flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          🖥️ 接入机器
        </h3>
        <Link href="/machines" className="text-xs" style={{ color: "var(--accent-blue)" }}>
          全部机器 →
        </Link>
      </div>
      <div className="space-y-3 flex-1 overflow-y-auto">
        {data.machines.slice(0, 8).map((m) => (
          <Link
            key={m.name}
            href={`/machines?name=${encodeURIComponent(m.name)}`}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-md transition-colors hover:bg-[var(--hover-bg)]"
            style={{ border: "1px solid var(--border-color)" }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: m.online ? "var(--accent-green)" : "var(--text-tertiary)" }}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }} title={m.alias}>
                  {m.alias}
                  {m.hostname && m.hostname !== m.name ? (
                    <span className="text-xs ml-2 font-normal" style={{ color: "var(--text-tertiary)" }}>
                      {m.hostname}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs truncate" style={{ color: "var(--text-tertiary)" }}>
                  最近上报: {m.last_report || "-"}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold" style={{ color: "var(--accent-green)" }}>
                {fmtCost(m.totalCost)}
              </p>
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                {m.calls.toLocaleString()} 次 / {fmtTokens(m.totalTokens)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
