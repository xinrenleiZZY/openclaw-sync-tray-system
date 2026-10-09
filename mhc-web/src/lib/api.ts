/**
 * 模型健康监控中心 - API 客户端
 * 在 Server Components 中直接 fetch 后端 API
 */

// API 地址优先级：
// 1) 容器内部 API_BASE_URL（docker-compose 注入，如 http://mhc-api:8000）
// 2) 按 MHC_HOST + MHC_API_PORT 拼接（浏览器端用 NEXT_PUBLIC_* 变量，服务端读 MHC_*）
// 3) 本地开发兜底
const MHC_HOST = process.env.NEXT_PUBLIC_MHC_HOST || process.env.MHC_HOST || "";
const MHC_API_PORT = process.env.NEXT_PUBLIC_MHC_API_PORT || process.env.MHC_API_PORT || "7601";
const API_BASE =
  process.env.API_BASE_URL ||
  (MHC_HOST ? `http://${MHC_HOST}:${MHC_API_PORT}` : "http://localhost:7601");

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    next: { revalidate: 5 },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ─── 类型定义 ───

export interface TrendPoint {
  date: string;
  calls: number;
  input: number;
  output: number;
  cost: number;
}

export interface Overview {
  machines: number;
  entries: number;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  today_calls: number;
  today_cost: number;
  today_tokens: number;
  trend: TrendPoint[];
  top_machines: MachineSummary[];
}

export interface MachineInfo {
  department: string;
  robot_name: string;
  ip: string;
  username: string;
  api_key1_name: string;
  api_key1_short: string;
  api_key2_name: string;
  api_key2_short: string;
  account: string;
  password: string;
}

export interface MachineSummary {
  name: string;
  alias: string;
  hostname: string;
  os_info: string;
  notes: string;
  enabled: boolean;
  machine_info?: MachineInfo;
  first_seen: string;
  last_seen: string;
  last_report: string;
  last_entries: number;
  online: boolean;
  version: string;
  entries: number;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
}

export interface GroupStat {
  name: string;
  entries: number;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
}

export interface SessionStat {
  machine: string;
  agent: string;
  session_id: string;
  session_file: string;
  entries: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  last_ts: string;
}

export interface PushRecord {
  id: number;
  machine: string;
  received_at: string;
  entries_count: number;
  inserted: number;
  duplicates: number;
  total_cost: number;
  total_tokens: number;
  detail: Record<string, unknown>;
}

export interface MachineDetail {
  machine: MachineSummary;
  agents: GroupStat[];
  models: GroupStat[];
  days: GroupStat[];
}

export interface AbnormalMachine {
  name: string;
  alias: string;
  hostname: string;
  os_info: string;
  notes: string;
  enabled: boolean;
  last_seen: string;
  last_push: string;
  idle_seconds: number | null;
}

export interface AbnormalResult {
  threshold_minutes: number;
  total_machines: number;
  abnormal_count: number;
  items: AbnormalMachine[];
}

export interface Settings {
  pricing: { input: number; output: number; cache_read: number; cache_write: number; usd_to_rmb: number };
  deepseek_pricing: {
    effective_date: string;
    currency: string;
    unit: string;
    models: Record<
      string,
      { peak: { cache_hit: number; cache_miss: number; output: number }; off_peak: { cache_hit: number; cache_miss: number; output: number } }
    >;
  };
  server: { host: string; api_port: number; web_port: number };
  push_token_configured: boolean;
  deepseek_api_key_configured: boolean;
  machine_aliases: Record<string, string>;
  notes: string;
}

export interface HourlyMachine {
  name: string;
  alias: string;
  total_cost: number;
  total_tokens: number;
  data: number[];       // 每小时成本
  token_data: number[]; // 每小时 tokens
}

export interface HourlyResult {
  hours: string[];
  hour_keys: string[];
  start: string;
  end: string;
  machines: HourlyMachine[];
}

export interface ScreenData {
  machines: number;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  today_calls: number;
  today_cost: number;
  today_tokens: number;
  trend: TrendPoint[];
  model_rank: GroupStat[];
  agent_rank: GroupStat[];
  machine_rank: MachineSummary[];
  model_trend: { day: string; model: string; calls: number; input: number; output: number; cost: number }[];
  sessions: { machine: string; agent: string; session_id: string; session_file: string; calls: number; tokens: number; cost: number }[];
}

export interface MachineDailyRow {
  machine: string;
  alias: string;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
}

export interface MachineDailyResult {
  day: string;
  items: MachineDailyRow[];
}

export interface MachineRankItem extends MachineDailyRow {
  daily: Record<string, number>;
}

export interface MachineRankResult {
  days: string[];
  start: string;
  end: string;
  items: MachineRankItem[];
}

export interface DeepseekBucket {
  calls: number;
  input: number;
  output: number;
  cache_hit: number;
  cache_miss: number;
  tokens: number;
  cost: number;
}

export interface DeepseekTrendPoint extends DeepseekBucket {
  date: string;
}

export interface DeepseekModelStat extends DeepseekBucket {
  model: string;
}

export interface DeepseekKeyStat extends DeepseekBucket {
  api_key_name: string;
  api_key: string;
}

export interface DeepseekModelTrend extends DeepseekBucket {
  day: string;
  model: string;
}

export interface DeepseekMonthly {
  month: string;
  calls: number;
  tokens: number;
  cost: number;
}

export interface DeepseekKeyTrend {
  day: string;
  api_key_name: string;
  calls: number;
  tokens: number;
  cost: number;
}

export interface DeepseekKeyDetailDaily extends DeepseekBucket {
  date: string;
}

export interface DeepseekKeyDetail {
  api_key_name: string;
  api_key: string;
  date_range: { start: string; end: string };
  daily: DeepseekKeyDetailDaily[];
  totals: DeepseekBucket;
}

export interface DeepseekKeyUsageItem extends DeepseekBucket {
  api_key_name: string;
  api_key: string;
  token_ratio: number;
  cost_ratio: number;
}

export interface DeepseekKeyUsage {
  date_range: { start: string; end: string };
  totals: { tokens: number; cost: number; calls: number };
  items: DeepseekKeyUsageItem[];
}

export interface KeyOwnerItem {
  id: number;
  api_key_name: string;
  owner: string;
  created_at: string;
  updated_at: string;
}

export interface KeyOwnerList {
  items: KeyOwnerItem[];
  keys: string[];
}

export interface KeyOwnerInput {
  api_key_name: string;
  owner: string;
}

export interface OwnerUsageItem extends DeepseekBucket {
  owner: string;
  keys: string[];
  key_count: number;
  token_ratio: number;
  cost_ratio: number;
}

export interface OwnerUsage {
  date_range: { start: string; end: string };
  totals: { tokens: number; cost: number; calls: number };
  items: OwnerUsageItem[];
}

export interface DeepseekOverview {
  date_range: { min: string; max: string };
  calls: number;
  input: number;
  output: number;
  cache_hit: number;
  cache_miss: number;
  tokens: number;
  totalCost: number;
  computedCost: number;
  currency: string;
  today_calls: number;
  today_cost: number;
  today_tokens: number;
  latest_date: string;
  latest_calls: number;
  latest_cost: number;
  latest_tokens: number;
  trend: DeepseekTrendPoint[];
  model_rank: DeepseekModelStat[];
  api_key_rank: DeepseekKeyStat[];
  model_trend: DeepseekModelTrend[];
  monthly: DeepseekMonthly[];
  api_key_trend: DeepseekKeyTrend[];
  imports: number;
  last_import: string;
  balance: DeepseekBalanceInfo;
}

export interface DeepseekImportRecord {
  id: number;
  filename: string;
  kind: string;
  rows: number;
  date_min: string;
  date_max: string;
  imported_at: string;
}

export interface DeepseekDailyUsage {
  date: string;
  start: number;
  end: number;
  topups: number;
  usage: number;
}

export interface DeepseekBalanceInfo {
  configured: boolean;
  total_balance: number | null;
  granted_balance: number | null;
  topped_up_balance: number | null;
  currency: string;
  is_available: boolean | null;
  fetched_at: string;
  initial_balance: number;
  total_topups: number;
  today_topup: number;
  today_usage: number;
  actual_usage: number;
  daily_usage: DeepseekDailyUsage[];
}

export interface DeepseekTopup {
  id: number;
  order_id: string;
  status: string;
  amount: number;
  pay_method: string;
  created_at: string;
  registered_at: string;
}

export interface DeepseekTopupResult {
  status: string;
  inserted: number;
  skipped: number;
  items: DeepseekTopup[];
}

export interface DeepseekTopupList {
  items: DeepseekTopup[];
  total: number;
  total_amount: number;
}

export interface AppInfo {
  name: string;
  version: string;
  developer: string;
  phone: string;
  description: string;
}

// ─── 模型价格 ───

export interface ModelPricePeriod {
  cache_hit: number;
  cache_miss: number;
  output: number;
}

export interface ModelPriceItem {
  id: number;
  model: string;
  effective_date: string;
  currency: string;
  unit: string;
  peak: ModelPricePeriod;
  off_peak: ModelPricePeriod;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ModelPriceModel {
  model: string;
  current: ModelPriceItem;
  history: ModelPriceItem[];
}

export interface ModelPriceList {
  models: ModelPriceModel[];
  total: number;
}

export interface ModelPriceInput {
  model: string;
  effective_date: string;
  currency?: string;
  unit?: string;
  peak: ModelPricePeriod;
  off_peak: ModelPricePeriod;
  enabled?: boolean;
}

export interface SourceVersion {
  version: string;
  date: string;
  name: string;
}

// ─── API Methods ───

export function getOverview(days = 7, scope: "all" | "deepseek" = "all"): Promise<Overview> {
  return fetchAPI(`/api/usage/overview?days=${days}&scope=${scope}`);
}

// 模型价格
export function getModelPrices(): Promise<ModelPriceList> {
  return clientFetch("/api/model-prices");
}

export async function createModelPrice(input: ModelPriceInput): Promise<{ status: string; item: ModelPriceItem }> {
  const res = await fetch(`${API_BASE}/api/model-prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(parseApiError(res.status, await res.text().catch(() => "")));
  return res.json();
}

export async function updateModelPrice(
  id: number,
  patch: Partial<ModelPriceInput> & { enabled?: boolean }
): Promise<{ status: string; item: ModelPriceItem }> {
  const res = await fetch(`${API_BASE}/api/model-prices/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(parseApiError(res.status, await res.text().catch(() => "")));
  return res.json();
}

export async function deleteModelPrice(id: number): Promise<{ status: string; id: number }> {
  const res = await fetch(`${API_BASE}/api/model-prices/${id}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(parseApiError(res.status, await res.text().catch(() => "")));
  return res.json();
}

export function getMachines(): Promise<{ machines: MachineSummary[]; total: number }> {
  return fetchAPI("/api/usage/machines");
}

export function getAbnormalMachines(thresholdMinutes = 120): Promise<AbnormalResult> {
  return clientFetch(`/api/usage/abnormal-machines?threshold_minutes=${thresholdMinutes}`);
}

export function getMachineDetail(name: string): Promise<MachineDetail> {
  return fetchAPI(`/api/usage/machines/${encodeURIComponent(name)}`);
}

export function getMachineDaily(day?: string): Promise<MachineDailyResult> {
  const params = new URLSearchParams();
  if (day) params.set("day", day);
  return fetchAPI(`/api/usage/machine-daily?${params.toString()}`);
}

export function getMachineRank(days = 30): Promise<MachineRankResult> {
  return fetchAPI(`/api/usage/machine-rank?days=${days}`);
}

export function getAgents(machine?: string, days?: number): Promise<{ items: GroupStat[] }> {
  const params = new URLSearchParams();
  if (machine) params.set("machine", machine);
  if (days) params.set("days", String(days));
  return fetchAPI(`/api/usage/agents?${params.toString()}`);
}

export function getModels(machine?: string, days?: number): Promise<{ items: GroupStat[] }> {
  const params = new URLSearchParams();
  if (machine) params.set("machine", machine);
  if (days) params.set("days", String(days));
  return fetchAPI(`/api/usage/models?${params.toString()}`);
}

export function getDays(machine?: string, days = 30): Promise<{ items: GroupStat[] }> {
  const params = new URLSearchParams();
  if (machine) params.set("machine", machine);
  params.set("days", String(days));
  return fetchAPI(`/api/usage/days?${params.toString()}`);
}

export function getSessions(machine?: string, limit = 20): Promise<{ items: SessionStat[]; total: number }> {
  const params = new URLSearchParams();
  if (machine) params.set("machine", machine);
  params.set("limit", String(limit));
  return fetchAPI(`/api/usage/sessions?${params.toString()}`);
}

export function getPushes(machine?: string, limit = 20): Promise<{ items: PushRecord[]; total: number }> {
  const params = new URLSearchParams();
  if (machine) params.set("machine", machine);
  params.set("limit", String(limit));
  return fetchAPI(`/api/usage/pushes?${params.toString()}`);
}

export function getSettings(): Promise<Settings> {
  return fetchAPI("/api/settings");
}

export function getScreen(days = 30): Promise<ScreenData> {
  return fetchAPI(`/api/usage/screen?days=${days}`);
}

export function getHourly(hours = 24): Promise<HourlyResult> {
  return clientFetch(`/api/usage/hourly?hours=${hours}`);
}

export function getDeepseekOverview(days?: number): Promise<DeepseekOverview> {
  const params = new URLSearchParams();
  if (days) params.set("days", String(days));
  const qs = params.toString();
  return fetchAPI(`/api/deepseek/overview${qs ? `?${qs}` : ""}`);
}

export function getDeepseekKeyDetail(key: string, days?: number, start?: string, end?: string): Promise<DeepseekKeyDetail> {
  const params = new URLSearchParams();
  params.set("key", key);
  if (days) params.set("days", String(days));
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return clientFetch(`/api/deepseek/key-detail?${params.toString()}`);
}

export function getDeepseekKeyUsage(days?: number, start?: string, end?: string): Promise<DeepseekKeyUsage> {
  const params = new URLSearchParams();
  if (days) params.set("days", String(days));
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return clientFetch(`/api/deepseek/key-usage?${params.toString()}`);
}

// Key 归属人员
export function getKeyOwners(): Promise<KeyOwnerList> {
  return clientFetch("/api/deepseek/key-owners");
}

export async function createKeyOwner(input: KeyOwnerInput): Promise<{ status: string; item: KeyOwnerItem }> {
  const res = await fetch(`${API_BASE}/api/deepseek/key-owners`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(parseApiError(res.status, await res.text().catch(() => "")));
  return res.json();
}

export async function updateKeyOwner(
  id: number,
  patch: Partial<KeyOwnerInput>
): Promise<{ status: string; item: KeyOwnerItem }> {
  const res = await fetch(`${API_BASE}/api/deepseek/key-owners/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(parseApiError(res.status, await res.text().catch(() => "")));
  return res.json();
}

export async function deleteKeyOwner(id: number): Promise<{ status: string; id: number }> {
  const res = await fetch(`${API_BASE}/api/deepseek/key-owners/${id}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(parseApiError(res.status, await res.text().catch(() => "")));
  return res.json();
}

export function getOwnerUsage(days?: number, start?: string, end?: string): Promise<OwnerUsage> {
  const params = new URLSearchParams();
  if (days) params.set("days", String(days));
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return clientFetch(`/api/deepseek/owner-usage?${params.toString()}`);
}

export function getDeepseekImports(): Promise<{ items: DeepseekImportRecord[] }> {
  return fetchAPI("/api/deepseek/imports");
}

export interface DeepseekUploadFileResult {
  filename: string;
  kind: string;
  status: string;
  rows: number;
  deleted: number;
  date_min: string;
  date_max: string;
  message?: string;
}

export interface DeepseekUploadResult {
  status: string;
  ok_count: number;
  total_rows: number;
  files: DeepseekUploadFileResult[];
}

export async function uploadDeepseekFiles(files: File[]): Promise<DeepseekUploadResult> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await fetch(`${API_BASE}/api/deepseek/upload`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`上传失败 (${res.status})${text ? `: ${text}` : ""}`);
  }
  return res.json();
}

export function getDeepseekBalance(): Promise<DeepseekBalanceInfo> {
  return clientFetch("/api/deepseek/balance");
}

export async function refreshDeepseekBalance(): Promise<{ status: string; balance: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE}/api/deepseek/balance/refresh`, { method: "POST", cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(parseApiError(res.status, text));
  }
  return res.json();
}

export async function parseDeepseekTopups(text: string): Promise<DeepseekTopupResult> {
  const res = await fetch(`${API_BASE}/api/deepseek/topups/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(parseApiError(res.status, text));
  }
  return res.json();
}

export function getDeepseekTopups(limit = 50): Promise<DeepseekTopupList> {
  return clientFetch(`/api/deepseek/topups?limit=${limit}`);
}

function parseApiError(status: number, text: string): string {
  try {
    const data = JSON.parse(text);
    if (data && data.detail) return String(data.detail);
  } catch {
    // ignore
  }
  return `HTTP ${status}`;
}

export function getSourceVersion(): Promise<SourceVersion> {
  return fetchAPI("/api/source/version");
}

export function getAppInfo(): Promise<AppInfo> {
  return fetchAPI("/api/info");
}

// 客户端组件使用的即时 fetch（不做服务端缓存）
export async function clientFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function updateSettings(patch: Record<string, unknown>): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

export async function updateMachine(name: string, patch: { alias?: string; notes?: string; enabled?: boolean }): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/api/usage/machines/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

export async function deleteMachine(name: string): Promise<{ status: string; machine: string; deleted_entries: number; deleted_pushes: number }> {
  const res = await fetch(`${API_BASE}/api/usage/machines/${encodeURIComponent(name)}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// 托盘一键同步：下发同步指令，所有在线托盘将在下一轮询周期各同步一次
export async function requestTraySync(): Promise<{ status: string; epoch: number }> {
  const res = await fetch(`${API_BASE}/api/tray/sync/request`, { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// 在线托盘版本状态：返回各在线托盘上报的版本号
export interface TraySyncStatus {
  epoch: number;
  acked_machines: number;
  machines: string[];
  versions: Record<string, string>;
}

export function getTraySyncStatus(): Promise<TraySyncStatus> {
  return clientFetch("/api/tray/sync/status");
}
