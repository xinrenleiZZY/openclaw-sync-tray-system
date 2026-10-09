import { getPushes } from "@/lib/api";
import { fmtCost } from "@/lib/format";

export default async function RecentPushFeed() {
  const data = await getPushes("", 8).catch(() => null);
  if (!data || data.items.length === 0) {
    return (
      <div className="hzx-card">
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          📤 最近推送
        </h3>
        <p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>
          暂无推送记录
        </p>
      </div>
    );
  }

  return (
    <div className="hzx-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          📤 最近推送
        </h3>
        <a href="/pushes" className="text-xs" style={{ color: "var(--accent-blue)" }}>
          全部记录 →
        </a>
      </div>
      <div className="space-y-2">
        {data.items.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between px-3 py-2 rounded-md"
            style={{ backgroundColor: "var(--bg-secondary)" }}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                {p.machine}
              </p>
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                {p.received_at} · {p.entries_count} 条
                {p.duplicates > 0 ? ` (新增 ${p.inserted} / 重复 ${p.duplicates})` : ""}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold" style={{ color: "var(--accent-green)" }}>
                {fmtCost(p.total_cost)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
