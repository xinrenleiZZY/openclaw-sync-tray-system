"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getKeyOwners, createKeyOwner, updateKeyOwner, deleteKeyOwner } from "@/lib/api";
import type { KeyOwnerItem, KeyOwnerList } from "@/lib/api";

const inputCls = "w-full rounded-md px-2.5 py-1.5 text-xs";
const inputStyle = {
  backgroundColor: "var(--bg-secondary)",
  border: "1px solid var(--border-color)",
  color: "var(--text-primary)",
} as const;

export default function KeyOwnersClient() {
  const [data, setData] = useState<KeyOwnerList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // 新增 / 编辑表单
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<KeyOwnerItem | null>(null);
  const [formKey, setFormKey] = useState("");
  const [formOwner, setFormOwner] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getKeyOwners();
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = data?.items ?? [];

  // 按归属人员分组（一名人员可对应多个 Key）
  const groups = useMemo(() => {
    const map = new Map<string, KeyOwnerItem[]>();
    for (const it of items) {
      const arr = map.get(it.owner) ?? [];
      arr.push(it);
      map.set(it.owner, arr);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "zh"))
      .map(([owner, list]) => ({
        owner,
        keys: list.slice().sort((a, b) => a.api_key_name.localeCompare(b.api_key_name, "zh")),
      }));
  }, [items]);

  const owners = useMemo(() => groups.map((g) => g.owner), [groups]);

  const assignedKeys = useMemo(() => new Set(items.map((i) => i.api_key_name)), [items]);
  const unassignedKeys = useMemo(
    () => (data?.keys ?? []).filter((k) => !assignedKeys.has(k)),
    [data, assignedKeys]
  );
  // 表单可选 Key：未归属的 Key + 正在编辑记录的当前 Key
  const keyCandidates = useMemo(() => {
    const set = new Set(unassignedKeys);
    if (editing) set.add(editing.api_key_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh"));
  }, [unassignedKeys, editing]);

  const openAdd = (owner = "") => {
    setEditing(null);
    setFormKey("");
    setFormOwner(owner);
    setFormOpen(true);
    setMsg("");
  };

  const openEdit = (it: KeyOwnerItem) => {
    setEditing(it);
    setFormKey(it.api_key_name);
    setFormOwner(it.owner);
    setFormOpen(true);
    setMsg("");
  };

  const openAddWithKey = (key: string) => {
    setEditing(null);
    setFormKey(key);
    setFormOwner("");
    setFormOpen(true);
    setMsg("");
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setFormKey("");
    setFormOwner("");
  };

  const submit = async () => {
    const key = formKey.trim();
    const owner = formOwner.trim();
    if (!key) return setMsg("请填写 Key 名称");
    if (!owner) return setMsg("请填写归属人员");
    setSubmitting(true);
    setMsg("");
    try {
      if (editing) {
        await updateKeyOwner(editing.id, { api_key_name: key, owner });
        setMsg(`已更新：${key} → ${owner}`);
      } else {
        await createKeyOwner({ api_key_name: key, owner });
        setMsg(`已新增归属：${key} → ${owner}`);
      }
      closeForm();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (it: KeyOwnerItem) => {
    if (!window.confirm(`确定删除归属「${it.api_key_name} → ${it.owner}」？此操作不可恢复。`)) return;
    try {
      await deleteKeyOwner(it.id);
      setMsg(`已删除归属：${it.api_key_name}`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const msgIsError = /请|失败|已存在|不可|不存在/.test(msg);

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="hzx-card">
          <p className="text-2xl font-bold" style={{ color: "var(--accent-blue)" }}>{groups.length}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>归属人员数</p>
        </div>
        <div className="hzx-card">
          <p className="text-2xl font-bold" style={{ color: "var(--accent-green)" }}>{items.length}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>已归属 Key 数</p>
        </div>
        <div className="hzx-card">
          <p className="text-2xl font-bold" style={{ color: "var(--accent-orange)" }}>{unassignedKeys.length}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>未归属 Key 数</p>
        </div>
      </div>

      {/* 说明 + 新增 */}
      <div className="hzx-card flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>👤 Key 归属人员</h3>
          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            维护每个 API Key 的归属人员。一名人员可归属多个 Key，同一 Key 只能归属一名人员（不可重复）。
            该归属用于 Deepseek 统计页「各 Key（归属人员）用量与占比」图表。未登记的 Key 会在图表中归入「未归属」。
          </p>
        </div>
        <button onClick={() => openAdd()} className="hzx-btn !py-2 !px-4 !text-sm">＋ 新增归属</button>
      </div>

      {msg && (
        <p className="text-sm" style={{ color: msgIsError ? "var(--accent-red)" : "var(--accent-green)" }}>{msg}</p>
      )}
      {error && <p className="text-sm" style={{ color: "var(--accent-red)" }}>加载失败：{error}</p>}

      {/* 未归属 Key 提示 */}
      {unassignedKeys.length > 0 && (
        <div className="hzx-card">
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            未归属 Key（{unassignedKeys.length}）— 点击可快速归属：
          </p>
          <div className="flex flex-wrap gap-2">
            {unassignedKeys.map((k) => (
              <button
                key={k}
                onClick={() => openAddWithKey(k)}
                title={`为 ${k} 指定归属人员`}
                className="rounded-md px-2 py-1 text-[11px] hover:opacity-80"
                style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-tertiary)" }}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 归属列表（按人员分组） */}
      {loading ? (
        <div className="hzx-card"><p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>加载中...</p></div>
      ) : groups.length === 0 ? (
        <div className="hzx-card"><p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>暂无归属记录，点击「新增归属」开始维护。</p></div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.owner} className="hzx-card">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{g.owner}</h3>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{g.keys.length} 个 Key</p>
                </div>
                <button onClick={() => openAdd(g.owner)} className="hzx-btn !py-1.5 !px-3 !text-xs">＋ 添加该人员 Key</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: "var(--text-secondary)" }}>
                      <th className="text-left py-1.5 font-medium">Key 名称</th>
                      <th className="text-left py-1.5 font-medium">更新时间</th>
                      <th className="text-right py-1.5 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.keys.map((it) => (
                      <tr key={it.id} className="border-t" style={{ borderColor: "var(--border-color)" }}>
                        <td className="py-2 pr-3" style={{ color: "var(--text-primary)" }}>{it.api_key_name}</td>
                        <td className="py-2 pr-3" style={{ color: "var(--text-tertiary)" }}>{it.updated_at || it.created_at}</td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button onClick={() => openEdit(it)} className="text-xs px-2 py-1 rounded hover:opacity-80" style={{ backgroundColor: "var(--bg-secondary)", color: "var(--accent-blue)" }}>编辑</button>
                            <button onClick={() => remove(it)} className="text-xs px-2 py-1 rounded hover:opacity-80" style={{ backgroundColor: "var(--bg-secondary)", color: "var(--accent-red)" }}>删除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新增 / 编辑表单 */}
      {formOpen && (
        <div className="hzx-card">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            {editing ? `✏️ 编辑归属：${editing.api_key_name}` : "➕ 新增 Key 归属"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>归属人员</label>
              <input
                list="key-owner-owner-list"
                value={formOwner}
                onChange={(e) => setFormOwner(e.target.value)}
                placeholder="如 张三"
                className={inputCls}
                style={inputStyle}
              />
              <datalist id="key-owner-owner-list">
                {owners.map((o) => <option key={o} value={o} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>Key 名称</label>
              <input
                list="key-owner-key-list"
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                placeholder="选择或输入 Key 名称"
                className={inputCls}
                style={inputStyle}
              />
              <datalist id="key-owner-key-list">
                {keyCandidates.map((k) => <option key={k} value={k} />)}
              </datalist>
            </div>
          </div>
          <p className="text-[11px] mt-2" style={{ color: "var(--text-tertiary)" }}>
            候选 Key 来自已上传的用量数据（未归属的优先展示）。同一 Key 只能归属一名人员。
          </p>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={submit} disabled={submitting} className="hzx-btn !py-2 !px-4 !text-sm">
              {submitting ? "保存中..." : editing ? "保存修改" : "添加"}
            </button>
            <button onClick={closeForm} className="px-4 py-2 rounded-md text-sm" style={{ backgroundColor: "var(--bg-secondary)", color: "var(--text-secondary)" }}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
