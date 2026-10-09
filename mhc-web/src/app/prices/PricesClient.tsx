"use client";

import { useCallback, useEffect, useState } from "react";
import { getModelPrices, createModelPrice, updateModelPrice, deleteModelPrice } from "@/lib/api";
import type { ModelPriceList, ModelPriceItem, ModelPricePeriod } from "@/lib/api";

const UNIT_DEFAULT = "元/百万 tokens";
const CURRENCY_DEFAULT = "CNY";

// 表单状态用字符串，便于输入、提交时转换
interface FormState {
  model: string;
  effective_date: string;
  currency: string;
  unit: string;
  peak_cache_hit: string;
  peak_cache_miss: string;
  peak_output: string;
  off_peak_cache_hit: string;
  off_peak_cache_miss: string;
  off_peak_output: string;
}

function emptyForm(model = ""): FormState {
  return {
    model,
    effective_date: "",
    currency: CURRENCY_DEFAULT,
    unit: UNIT_DEFAULT,
    peak_cache_hit: "",
    peak_cache_miss: "",
    peak_output: "",
    off_peak_cache_hit: "",
    off_peak_cache_miss: "",
    off_peak_output: "",
  };
}

function itemToForm(item: ModelPriceItem): FormState {
  const n = (v: number) => (String(v) === "0" ? "0" : String(v));
  return {
    model: item.model,
    effective_date: item.effective_date,
    currency: item.currency,
    unit: item.unit,
    peak_cache_hit: n(item.peak.cache_hit),
    peak_cache_miss: n(item.peak.cache_miss),
    peak_output: n(item.peak.output),
    off_peak_cache_hit: n(item.off_peak.cache_hit),
    off_peak_cache_miss: n(item.off_peak.cache_miss),
    off_peak_output: n(item.off_peak.output),
  };
}

function num(v: string): number {
  const x = parseFloat(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
}

function buildPayload(f: FormState) {
  const peak: ModelPricePeriod = { cache_hit: num(f.peak_cache_hit), cache_miss: num(f.peak_cache_miss), output: num(f.peak_output) };
  const off_peak: ModelPricePeriod = { cache_hit: num(f.off_peak_cache_hit), cache_miss: num(f.off_peak_cache_miss), output: num(f.off_peak_output) };
  return { model: f.model.trim(), effective_date: f.effective_date.trim(), currency: f.currency.trim() || CURRENCY_DEFAULT, unit: f.unit.trim() || UNIT_DEFAULT, peak, off_peak };
}

function numField(change: (v: string) => void) {
  return (e: React.ChangeEvent<HTMLInputElement>) => change(e.target.value);
}

const inputCls = "w-full rounded-md px-2.5 py-1.5 text-xs";
const inputStyle = { backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" } as const;

// ─── 价格表单（新增/编辑共用） ───
function PriceFormFields({
  form,
  setForm,
  showModel = true,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  showModel?: boolean;
}) {
  const set = (k: keyof FormState) => (v: string) => setForm({ ...form, [k]: v });
  const field = (label: string, key: keyof FormState) => (
    <div>
      <label className="block text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>{label}</label>
      <input type="number" step="any" min="0" value={form[key]} onChange={numField(set(key))} className={inputCls} style={inputStyle} />
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {showModel && (
        <div className="sm:col-span-2">
          <label className="block text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>模型名称</label>
          <input value={form.model} onChange={(e) => set("model")(e.target.value)} placeholder="如 deepseek-v4-flash" className={inputCls} style={inputStyle} />
        </div>
      )}
      <div className="sm:col-span-2">
        <label className="block text-[10px] mb-0.5" style={{ color: "var(--text-secondary)" }}>生效日期（该价格时期）</label>
        <input type="date" value={form.effective_date} onChange={(e) => set("effective_date")(e.target.value)} className={inputCls} style={inputStyle} />
      </div>

      <div className="sm:col-span-4 lg:col-span-4">
        <p className="text-[10px] mb-1 font-medium" style={{ color: "var(--accent-orange)" }}>高峰时段 (peak)</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {field("缓存命中 (元/百万)", "peak_cache_hit")}
          {field("缓存未命中 (元/百万)", "peak_cache_miss")}
          {field("输出 (元/百万)", "peak_output")}
        </div>
      </div>
      <div className="sm:col-span-4 lg:col-span-4">
        <p className="text-[10px] mb-1 font-medium" style={{ color: "var(--accent-green)" }}>空闲时段 (off_peak)</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {field("缓存命中 (元/百万)", "off_peak_cache_hit")}
          {field("缓存未命中 (元/百万)", "off_peak_cache_miss")}
          {field("输出 (元/百万)", "off_peak_output")}
        </div>
      </div>
    </div>
  );
}

// ─── 单个模型卡片 ───
function ModelCard({
  model,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  model: ModelPriceList["models"][number];
  onAdd: (model: string) => void;
  onEdit: (item: ModelPriceItem) => void;
  onToggle: (item: ModelPriceItem) => void;
  onDelete: (item: ModelPriceItem) => void;
}) {
  return (
    <div className="hzx-card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{model.model}</h3>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {model.history.length} 个时期 · 当前生效：{model.current.enabled ? model.current.effective_date : "（无启用时期）"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--endspace-accent-dim)", color: "var(--text-secondary)" }}>
            {model.current.unit}
          </span>
          <button onClick={() => onAdd(model.model)} className="hzx-btn !py-1.5 !px-3 !text-xs">＋ 新增时期</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-secondary)" }}>
              <th className="text-left py-1.5 font-medium">生效日期</th>
              <th className="text-left py-1.5 font-medium">时段</th>
              <th className="text-right py-1.5 font-medium">缓存命中</th>
              <th className="text-right py-1.5 font-medium">缓存未命中</th>
              <th className="text-right py-1.5 font-medium">输出</th>
              <th className="text-center py-1.5 font-medium">状态</th>
              <th className="text-right py-1.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {model.history.length === 0 && (
              <tr><td colSpan={7} className="py-3 text-center" style={{ color: "var(--text-tertiary)" }}>暂无价格时期</td></tr>
            )}
            {model.history.map((item) => (
              <HistoryRow key={item.id} item={item} onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryRow({
  item,
  onEdit,
  onToggle,
  onDelete,
}: {
  item: ModelPriceItem;
  onEdit: (item: ModelPriceItem) => void;
  onToggle: (item: ModelPriceItem) => void;
  onDelete: (item: ModelPriceItem) => void;
}) {
  const periods: Array<{ label: string; color: string; p: ModelPricePeriod }> = [
    { label: "高峰", color: "var(--accent-orange)", p: item.peak },
    { label: "空闲", color: "var(--accent-green)", p: item.off_peak },
  ];
  return (
    <>
      {periods.map((per, idx) => (
        <tr key={`${item.id}-${idx}`} className="border-t" style={{ borderColor: "var(--border-color)", opacity: item.enabled ? 1 : 0.45 }}>
          {idx === 0 && (
            <td rowSpan={2} className="py-2 pr-3 whitespace-nowrap align-top" style={{ color: "var(--text-primary)" }}>
              {item.effective_date}
            </td>
          )}
          <td className="py-2 pr-3 whitespace-nowrap" style={{ color: per.color }}>{per.label}时段</td>
          <td className="py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{per.p.cache_hit}</td>
          <td className="py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{per.p.cache_miss}</td>
          <td className="py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{per.p.output}</td>
          {idx === 0 && (
            <td rowSpan={2} className="py-2 text-center align-top whitespace-nowrap">
              <span className="inline-block px-2 py-0.5 rounded text-[11px]" style={{
                backgroundColor: item.enabled ? "rgba(52,211,153,0.14)" : "rgba(148,163,184,0.14)",
                color: item.enabled ? "var(--accent-green)" : "var(--text-tertiary)",
              }}>
                {item.enabled ? "启用" : "已取消"}
              </span>
            </td>
          )}
          {idx === 0 && (
            <td rowSpan={2} className="py-2 text-right align-top whitespace-nowrap">
              <div className="inline-flex items-center gap-1.5">
                <button onClick={() => onEdit(item)} className="text-xs px-2 py-1 rounded hover:opacity-80" style={{ backgroundColor: "var(--bg-secondary)", color: "var(--accent-blue)" }}>编辑</button>
                <button onClick={() => onToggle(item)} className="text-xs px-2 py-1 rounded hover:opacity-80" style={{ backgroundColor: "var(--bg-secondary)", color: item.enabled ? "var(--accent-orange)" : "var(--accent-green)" }}>
                  {item.enabled ? "取消" : "启用"}
                </button>
                <button onClick={() => onDelete(item)} className="text-xs px-2 py-1 rounded hover:opacity-80" style={{ backgroundColor: "var(--bg-secondary)", color: "var(--accent-red)" }}>删除</button>
              </div>
            </td>
          )}
        </tr>
      ))}
    </>
  );
}

// ─── 主组件 ───
export default function PricesClient() {
  const [data, setData] = useState<ModelPriceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // 新增 / 编辑弹窗
  const [adding, setAdding] = useState<{ open: boolean; model: string }>({ open: false, model: "" });
  const [editing, setEditing] = useState<ModelPriceItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getModelPrices();
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

  const openAdd = (model: string) => {
    setEditing(null);
    setForm(emptyForm(model));
    setAdding({ open: true, model });
  };
  const openEdit = (item: ModelPriceItem) => {
    setAdding({ open: false, model: "" });
    setForm(itemToForm(item));
    setEditing(item);
  };
  const closeForm = () => {
    setAdding({ open: false, model: "" });
    setEditing(null);
  };

  const submit = async () => {
    const payload = buildPayload(form);
    if (!payload.model) return setMsg("请填写模型名称");
    if (!payload.effective_date) return setMsg("请填写生效日期");
    setSubmitting(true);
    setMsg("");
    try {
      if (editing) {
        await updateModelPrice(editing.id, payload);
        setMsg("价格时期已更新");
      } else {
        await createModelPrice(payload);
        setMsg("已新增价格时期");
      }
      closeForm();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleItem = async (item: ModelPriceItem) => {
    try {
      await updateModelPrice(item.id, { enabled: !item.enabled });
      setMsg(item.enabled ? `已取消 ${item.model} @ ${item.effective_date} 的价格` : `已启用 ${item.model} @ ${item.effective_date} 的价格`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteItem = async (item: ModelPriceItem) => {
    if (!window.confirm(`确定删除 ${item.model} @ ${item.effective_date} 的价格时期？此操作不可恢复。`)) return;
    try {
      await deleteModelPrice(item.id);
      setMsg(`已删除 ${item.model} @ ${item.effective_date}`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const totalPeriods = data?.models.reduce((a, m) => a + m.history.length, 0) ?? 0;
  const activePeriods = data?.models.reduce((a, m) => a + m.history.filter((h) => h.enabled).length, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="hzx-card">
          <p className="text-2xl font-bold" style={{ color: "var(--accent-blue)" }}>{data?.models.length ?? "-"}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>模型数</p>
        </div>
        <div className="hzx-card">
          <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{totalPeriods}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>价格时期总数</p>
        </div>
        <div className="hzx-card">
          <p className="text-2xl font-bold" style={{ color: "var(--accent-green)" }}>{activePeriods}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>生效中时期</p>
        </div>
      </div>

      {/* 说明 + 新增 */}
      <div className="hzx-card flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>💰 模型价格台账</h3>
          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            价格延用 DeepSeek 结构（高峰/空闲 × 缓存命中/未命中/输出，单位 {UNIT_DEFAULT}）。仅作台账与历史参考，<b>不参与</b>成本计算；成本仍以机器上报 totalCost 为准。价格由人工维护，可随时调整或取消某个时期。
          </p>
        </div>
        <button onClick={() => openAdd("")} className="hzx-btn !py-2 !px-4 !text-sm">＋ 新增模型价格</button>
      </div>

      {msg && (
        <p className="text-sm" style={{ color: msg.includes("请") || msg.includes("已存在") || msg.includes("失败") ? "var(--accent-red)" : "var(--accent-green)" }}>{msg}</p>
      )}
      {error && <p className="text-sm" style={{ color: "var(--accent-red)" }}>加载失败：{error}</p>}

      {loading ? (
        <div className="hzx-card"><p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>加载中...</p></div>
      ) : !data || data.models.length === 0 ? (
        <div className="hzx-card"><p className="text-sm py-4 text-center" style={{ color: "var(--text-tertiary)" }}>暂无价格数据，点击「新增模型价格」开始维护。</p></div>
      ) : (
        <div className="space-y-4">
          {data.models.map((m) => (
            <ModelCard key={m.model} model={m} onAdd={openAdd} onEdit={openEdit} onToggle={toggleItem} onDelete={deleteItem} />
          ))}
        </div>
      )}

      {/* 新增/编辑表单 */}
      {(adding.open || editing) && (
        <div className="hzx-card">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            {editing ? `✏️ 编辑价格时期：${editing.model} @ ${editing.effective_date}` : `➕ 新增价格时期${adding.model ? `：${adding.model}` : ""}`}
          </h3>
          <PriceFormFields form={form} setForm={setForm} showModel={!editing} />
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
