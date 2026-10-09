"use client";

import { useEffect, useState, useCallback } from "react";
import { clientFetch, getMachineDetail, updateMachine, deleteMachine } from "@/lib/api";
import { fmtTokens, fmtCost } from "@/lib/format";
import type { MachineSummary, MachineDetail, GroupStat, MachineInfo } from "@/lib/api";

// 机器详细信息弹窗字段（对应飞书多维表格的列）
const INFO_FIELDS: { label: string; key: keyof MachineInfo }[] = [
  { label: "部门", key: "department" },
  { label: "机器人名称", key: "robot_name" },
  { label: "IP 地址", key: "ip" },
  { label: "用户名", key: "username" },
  { label: "API Key 名称", key: "api_key1_name" },
  { label: "API Key 缩写", key: "api_key1_short" },
  { label: "API Key2 名称", key: "api_key2_name" },
  { label: "API Key2 缩写", key: "api_key2_short" },
  { label: "账号", key: "account" },
  { label: "密码", key: "password" },
];

function DetailTable({ title, items, accent }: { title: string; items: GroupStat[]; accent: string }) {
  if (items.length === 0) {
    return <p className="text-xs py-2" style={{ color: "var(--text-tertiary)" }}>{title}: 暂无数据</p>;
  }
  return (
    <div>
      <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: "var(--bg-secondary)" }}>
              <th className="text-left px-2 py-1 font-medium" style={{ color: "var(--text-secondary)" }}>名称</th>
              <th className="text-right px-2 py-1 font-medium" style={{ color: "var(--text-secondary)" }}>调用</th>
              <th className="text-right px-2 py-1 font-medium" style={{ color: "var(--text-secondary)" }}>tokens</th>
              <th className="text-right px-2 py-1 font-medium" style={{ color: "var(--text-secondary)" }}>成本</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 10).map((it) => (
              <tr key={it.name} className="border-t" style={{ borderColor: "var(--border-color)" }}>
                <td className="px-2 py-1 truncate max-w-32" style={{ color: accent }}>{it.name}</td>
                <td className="px-2 py-1 text-right" style={{ color: "var(--text-primary)" }}>{it.calls.toLocaleString()}</td>
                <td className="px-2 py-1 text-right" style={{ color: "var(--text-secondary)" }}>{fmtTokens(it.totalTokens)}</td>
                <td className="px-2 py-1 text-right font-medium" style={{ color: "var(--accent-green)" }}>{fmtCost(it.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MachinesClient({ initialName }: { initialName: string }) {
  const [machines, setMachines] = useState<MachineSummary[]>([]);
  const [selected, setSelected] = useState<string>(initialName);
  const [detail, setDetail] = useState<MachineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [infoMachine, setInfoMachine] = useState<MachineSummary | null>(null);

  const loadMachines = useCallback(async () => {
    try {
      const data = await clientFetch<{ machines: MachineSummary[] }>("/api/usage/machines");
      setMachines(data.machines);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (name: string) => {
    setSelected(name);
    try {
      const data = await getMachineDetail(name);
      setDetail(data);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  useEffect(() => {
    if (initialName) loadDetail(initialName);
  }, [initialName, loadDetail]);

  const saveEdit = async (name: string, patch: { alias?: string; notes?: string }) => {
    await updateMachine(name, patch);
    await loadMachines();
    if (selected === name && detail) {
      const d = await getMachineDetail(name).catch(() => null);
      if (d) setDetail(d);
    }
  };

  const removeMachine = async (name: string) => {
    setDeleting(true);
    try {
      const result = await deleteMachine(name);
      if (selected === name) {
        setSelected("");
        setDetail(null);
      }
      setConfirmDelete(null);
      await loadMachines();
      alert(`已删除机器 ${name}（用量 ${result.deleted_entries} 条、推送 ${result.deleted_pushes} 条）`);
    } catch (e) {
      alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>加载中...</p>;
  }

  if (machines.length === 0) {
    return (
      <div className="hzx-card">
        <p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>
          暂无机器上报，请在各虚拟机运行推送脚本后刷新。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 机器卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {machines.map((m) => (
          <div
            key={m.name}
            className="relative cursor-pointer rounded-xl p-4 transition-all"
            style={{
              backgroundColor: "var(--card-bg)",
              border: `1px solid ${selected === m.name ? "var(--endspace-accent)" : "var(--border-color)"}`,
              boxShadow: selected === m.name ? "0 0 0 1px var(--endspace-accent-dim)" : "var(--card-shadow)",
            }}
          >
            <button
              onClick={() => { loadDetail(m.name); setInfoMachine(m); }}
              className="absolute inset-0 z-10"
              aria-label={`查看 ${m.alias} 详情`}
            />
            <div className="relative flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.online ? "var(--accent-green)" : "var(--text-tertiary)" }} />
                <h3 className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                  <span title={m.alias}>{m.alias}</span>
                </h3>
                {m.hostname && m.hostname !== m.name && (
                  <span
                    className="text-xs truncate shrink-0 max-w-24"
                    title={`主机名 ${m.hostname}`}
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {m.hostname}
                  </span>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {confirmDelete === m.name ? (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeMachine(m.name); }}
                      disabled={deleting}
                      className="relative z-20 px-2 py-0.5 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: "var(--accent-red)" }}
                    >
                      {deleting ? "删除中..." : "确认删除"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                      className="relative z-20 px-2 py-0.5 rounded text-xs"
                      style={{ backgroundColor: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(confirmDelete === m.name ? null : m.name); }}
                    className="relative z-20 px-2 py-0.5 rounded text-xs transition-opacity hover:opacity-80"
                    style={{ backgroundColor: "rgba(248,81,73,0.12)", color: "var(--accent-red)" }}
                    title="删除机器（含全部用量数据）"
                  >
                    🗑 删除
                  </button>
                )}
              </div>
            </div>
            <div className="relative">
              <p className="text-xs mb-1 truncate" title={m.os_info || ""} style={{ color: "var(--text-tertiary)" }}>
                {m.os_info || "未知系统"}
                {m.name !== m.alias ? ` · 标识 ${m.name}` : ""}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                  {m.calls.toLocaleString()} 次
                </span>
                <span className="text-sm font-bold" style={{ color: "var(--accent-green)" }}>
                  {fmtCost(m.totalCost)}
                </span>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                最近上报: {m.last_report || "-"}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* 机器详情 */}
      {detail && (
        <div className="hzx-card">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                {detail.machine.alias} <span className="text-sm font-normal" style={{ color: "var(--text-tertiary)" }}>{detail.machine.name}</span>
              </h3>
              <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                首次上报 {detail.machine.first_seen} · 最近上报 {detail.machine.last_report}
                {detail.machine.version ? ` · 版本 V${detail.machine.version}` : ""}
              </p>
            </div>
            <MachineEditForm machine={detail.machine} onSave={saveEdit} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: "调用次数", value: detail.machine.calls.toLocaleString(), color: "var(--accent-blue)" },
              { label: "输入 tokens", value: fmtTokens(detail.machine.input), color: "var(--text-primary)" },
              { label: "输出 tokens", value: fmtTokens(detail.machine.output), color: "var(--text-primary)" },
              { label: "总成本", value: fmtCost(detail.machine.totalCost), color: "var(--accent-green)" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg p-3 text-center" style={{ backgroundColor: "var(--bg-secondary)" }}>
                <p className="text-lg font-semibold" style={{ color: s.color }}>{s.value}</p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <DetailTable title="🤖 按 Agent" items={detail.agents} accent="var(--accent-blue)" />
            <DetailTable title="🧠 按模型" items={detail.models} accent="var(--accent-orange)" />
            <DetailTable title="📅 按日期" items={detail.days} accent="var(--accent-green)" />
          </div>
        </div>
      )}

      {/* 机器信息弹窗 */}
      {infoMachine && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setInfoMachine(null)}
        >
          <div
            className="hzx-card w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: "85vh", overflowY: "auto" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                机器信息 · {infoMachine.alias}
              </h3>
              <button
                onClick={() => setInfoMachine(null)}
                className="text-lg leading-none rounded px-2 py-1"
                style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)" }}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-lg p-3 sm:col-span-2" style={{ backgroundColor: "var(--bg-secondary)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>客户端版本</p>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {infoMachine.version ? `V${infoMachine.version}` : "未知"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {INFO_FIELDS.map((f) => (
                <div key={f.key} className="rounded-lg p-3" style={{ backgroundColor: "var(--bg-secondary)" }}>
                  <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{f.label}</p>
                  <p className="text-sm font-medium break-all" title={infoMachine.machine_info?.[f.key] || "-"} style={{ color: "var(--text-primary)" }}>
                    {infoMachine.machine_info?.[f.key] || "-"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MachineEditForm({ machine, onSave }: {
  machine: MachineSummary;
  onSave: (name: string, patch: { alias?: string; notes?: string }) => Promise<void>;
}) {
  const [alias, setAlias] = useState(machine.alias || machine.name);
  const [notes, setNotes] = useState(machine.notes || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(machine.name, { alias: alias.trim(), notes: notes.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
        placeholder="显示名"
        className="rounded-md px-2 py-1.5 text-sm w-32"
        style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="备注"
        className="rounded-md px-2 py-1.5 text-sm w-40"
        style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
      />
      <button onClick={save} disabled={saving} className="hzx-btn !py-1.5 !px-3 !text-xs">
        {saving ? "保存中..." : "保存"}
      </button>
    </div>
  );
}
