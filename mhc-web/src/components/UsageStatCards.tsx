import { getOverview } from "@/lib/api";
import { fmtTokens, fmtCost } from "@/lib/format";

export default async function UsageStatCards() {
  const data = await getOverview().catch(() => null);
  if (!data) return null;

  const stats = [
    { label: "接入机器", value: String(data.machines), color: "var(--accent-blue)", sub: "台虚拟机/主机" },
    { label: "总调用次数", value: data.calls.toLocaleString(), color: "var(--accent-blue)", sub: `累计 ${fmtTokens(data.totalTokens)} tokens` },
    { label: "总成本", value: fmtCost(data.totalCost), color: "var(--accent-green)", sub: `输入 ${fmtTokens(data.input)} / 输出 ${fmtTokens(data.output)}` },
    { label: "今日成本", value: fmtCost(data.today_cost), color: "var(--accent-orange)", sub: `今日 ${data.today_calls.toLocaleString()} 次调用` },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl p-4"
          style={{
            backgroundColor: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            boxShadow: "var(--card-shadow)",
          }}
        >
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            {s.label}
          </p>
          <p className="text-2xl font-bold" style={{ color: s.color }}>
            {s.value}
          </p>
          <p className="text-xs mt-1 truncate" style={{ color: "var(--text-tertiary)" }}>
            {s.sub}
          </p>
        </div>
      ))}
    </div>
  );
}
