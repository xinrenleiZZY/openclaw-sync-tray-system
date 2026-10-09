"use client";

import { Fragment, useEffect, useState } from "react";
import { clientFetch, updateSettings, getAppInfo, getSourceVersion } from "@/lib/api";
import type { Settings, AppInfo, SourceVersion } from "@/lib/api";

export default function SettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [sourceVer, setSourceVer] = useState<SourceVersion | null>(null);
  const [token, setToken] = useState("");
  const [dsKey, setDsKey] = useState("");
  const [pricing, setPricing] = useState<Settings["pricing"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [vmTab, setVmTab] = useState("oneclick");
  const [copiedKey, setCopiedKey] = useState("");

  useEffect(() => {
    clientFetch<Settings>("/api/settings").then(setSettings).catch(() => setSettings(null));
    getAppInfo().then(setInfo).catch(() => setInfo(null));
    getSourceVersion().then(setSourceVer).catch(() => setSourceVer(null));
  }, []);

  useEffect(() => {
    if (settings) setPricing(settings.pricing);
  }, [settings]);

  const save = async (patch: Record<string, unknown>, successText: string) => {
    setSaving(true);
    setMsg("");
    try {
      await updateSettings(patch);
      const fresh = await clientFetch<Settings>("/api/settings");
      setSettings(fresh);
      setMsg(successText);
    } catch (e) {
      setMsg(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>加载中...</p>;
  }

  const pushUrl = `http://${settings.server.host}:${settings.server.api_port}`;
  const scriptCmd = `python openclaw_usage_stats.py --push --server ${pushUrl} --machine vm-01`;

  const vmScripts = [
    {
      key: "oneclick",
      label: "一键",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
      ),
      title: "最省事：复制下面这一条命令，把“你的机器名”改成实际机器名后粘贴到目标电脑 PowerShell 执行",
      code: `powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr '${pushUrl}/api/source/mhc-install' -OutFile $env:TEMP\\mhc-install.ps1; & $env:TEMP\\mhc-install.ps1 -Machine '你的机器名'"`,
    },
    {
      key: "cmd",
      label: "CMD",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
      ),
      title: "目标电脑 CMD：下载部署包并一键安装",
      code: `curl -L -o mhc-tray.zip ${pushUrl}/api/source/download

rem 解压（cmd 用自带 tar；旧系统可用 powershell 方式见下）
tar -xf mhc-tray.zip
rem 备选：powershell -Command "Expand-Archive -Force .\\mhc-tray.zip ."

cd 模型健康监控\\openclaw-sync-tray
powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1 -Machine 你的机器名`,
    },
    {
      key: "powershell",
      label: "POWERSHELL",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 6 12 12 7 18" /><line x1="13" y1="18" x2="19" y2="18" /></svg>
      ),
      title: "目标电脑 PowerShell：下载部署包并一键安装",
      code: `# 下载部署包
Invoke-WebRequest -Uri "${pushUrl}/api/source/download" -OutFile "$env:TEMP\\mhc-tray.zip"

# 解压到临时目录
Expand-Archive -Force "$env:TEMP\\mhc-tray.zip" "$env:TEMP"

# 进入安装脚本目录并安装（机器名可自定义）
Set-Location "$env:TEMP\\模型健康监控\\openclaw-sync-tray"
powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1 -Machine 你的机器名`,
    },
    {
      key: "python",
      label: "PYTHON",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
      ),
      title: "机器上已有同步脚本：直接推送",
      code: scriptCmd,
    },
  ];
  const activeScript = vmScripts.find((s) => s.key === vmTab) ?? vmScripts[0];

  const copyCode = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 1600);
  };

  const isComment = (line: string) => /^\s*(rem\b|#)/.test(line);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 系统信息 */}
      <div className="hzx-card">
        <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          ℹ️ 系统信息
        </h3>
        {info && (
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt style={{ color: "var(--text-secondary)" }}>名称</dt><dd style={{ color: "var(--text-primary)" }}>{info.name}</dd></div>
            <div className="flex justify-between"><dt style={{ color: "var(--text-secondary)" }}>版本</dt><dd style={{ color: "var(--text-primary)" }}>V{info.version}</dd></div>
            <div className="flex justify-between"><dt style={{ color: "var(--text-secondary)" }}>开发者</dt><dd style={{ color: "var(--text-primary)" }}>{info.developer}</dd></div>
            <div className="flex justify-between"><dt style={{ color: "var(--text-secondary)" }}>电话</dt><dd style={{ color: "var(--text-primary)" }}>{info.phone}</dd></div>
            <div className="flex justify-between"><dt style={{ color: "var(--text-secondary)" }}>服务地址</dt><dd style={{ color: "var(--accent-blue)" }}>{pushUrl}</dd></div>
            <div className="flex justify-between"><dt style={{ color: "var(--text-secondary)" }}>Web 地址</dt><dd style={{ color: "var(--accent-blue)" }}>http://{settings.server.host}:{settings.server.web_port}</dd></div>
            <div className="flex justify-between"><dt style={{ color: "var(--text-secondary)" }}>推送令牌</dt><dd style={{ color: settings.push_token_configured ? "var(--accent-green)" : "var(--accent-orange)" }}>{settings.push_token_configured ? "已配置" : "未配置（局域网直连）"}</dd></div>
          </dl>
        )}
      </div>

      {/* 虚拟机同步指引 */}
      <div className="hzx-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            📡 虚拟机同步指引
          </h3>
          {sourceVer && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--endspace-accent-dim)", color: "var(--accent-blue)" }}>
              最新版本 V{sourceVer.version}（{sourceVer.date}）
            </span>
          )}
        </div>

        <div>
          {/* 方式标签页（横向可滚动，图标 + 名称） */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3" style={{ borderBottom: "1px solid var(--border-color)" }}>
            {vmScripts.map((s) => {
              const isActive = s.key === vmTab;
              return (
                <button
                  key={s.key}
                  onClick={() => setVmTab(s.key)}
                  className="min-w-[76px] flex flex-col items-center gap-1 px-2 py-2 rounded-lg border shrink-0 transition-colors"
                  style={{
                    borderColor: isActive ? "var(--accent-blue)" : "var(--border-color)",
                    color: isActive ? "var(--accent-blue)" : "var(--text-secondary)",
                    backgroundColor: isActive ? "var(--endspace-accent-dim)" : "transparent",
                  }}
                >
                  {s.icon}
                  <span className="text-[11px] font-semibold tracking-wide">{s.label}</span>
                </button>
              );
            })}
          </div>

          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            {activeScript.title}
          </p>

          {/* 代码块：顶栏（语言名 + 复制） + 行号 + 代码 */}
          <div className="rounded-lg overflow-hidden border" style={{ borderColor: "var(--border-color)" }}>
            <div
              className="flex items-center justify-between px-3 py-1.5"
              style={{ backgroundColor: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-color)" }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {activeScript.label}
              </span>
              <button
                onClick={() => copyCode(activeScript.key, activeScript.code)}
                className="text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors"
                style={{
                  color: copiedKey === activeScript.key ? "var(--accent-green)" : "var(--accent-blue)",
                  border: "1px solid currentColor",
                  backgroundColor: "transparent",
                }}
              >
                {copiedKey === activeScript.key ? "已复制 ✓" : "复制"}
              </button>
            </div>

            <div className="flex text-xs" style={{ backgroundColor: "var(--bg-secondary)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>
              {/* 行号列（不随代码横向滚动） */}
              <div
                className="select-none text-right py-2 pr-2 shrink-0"
                style={{ color: "var(--text-tertiary)", borderRight: "1px solid var(--border-color)", minWidth: "2.4rem" }}
              >
                {activeScript.code.split("\n").map((_, i) => (
                  <div key={i} className="leading-6">{i + 1}</div>
                ))}
              </div>
              {/* 代码列（可横向滚动） */}
              <div className="flex-1 overflow-x-auto py-2 pl-3 pr-3">
                <pre className="whitespace-pre leading-6">
                  {activeScript.code.split("\n").map((line, i) => (
                    <div key={i} style={{ color: isComment(line) ? "var(--accent-green)" : "var(--text-primary)" }}>
                      {line || " "}
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          </div>

          <ul className="mt-3 text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
            <li>① --machine：机器唯一标识，建议中文名（人事138）或 vm-01，默认取主机名</li>
            <li>② 托盘每 2 小时自动推送，重复执行自动去重</li>
            <li>③ 托盘启动时自动检查更新并升级到最新版（保留机器名配置）</li>
            <li>④ 详细说明见部署包内"使用说明书.md"</li>
          </ul>
        </div>
      </div>

      {/* 推送令牌 */}
      <div className="hzx-card">
        <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          🔑 推送令牌（可选）
        </h3>
        <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
          设置后，虚拟机推送需携带 Header <code className="px-1 py-0.5 rounded" style={{ backgroundColor: "var(--bg-tertiary)" }}>X-Push-Token</code> 才能入库。
        </p>
        <div className="flex gap-2 mb-3">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="留空则不启用令牌"
            className="flex-1 rounded-md px-3 py-2 text-sm"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
          />
          <button
            onClick={() => save({ push_token: token }, "令牌已保存")}
            disabled={saving}
            className="hzx-btn !py-2 !px-3 !text-xs"
          >
            保存
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          保存后令牌仅存在于服务器 data/settings.json 中，页面不再回显明文。
        </p>
      </div>

      {/* DeepSeek API Key（余额查询） */}
      <div className="hzx-card">
        <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          💳 DeepSeek API Key（余额查询）
        </h3>
        <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
          用于调用官方{" "}
          <code className="px-1 py-0.5 rounded" style={{ backgroundColor: "var(--bg-tertiary)" }}>/user/balance</code>{" "}
          接口，每小时自动拉取账户余额快照，测算每日实际用量；统计中心可手动"立即刷新"。
        </p>
        <div className="flex gap-2 mb-3">
          <input
            value={dsKey}
            onChange={(e) => setDsKey(e.target.value)}
            placeholder={settings.deepseek_api_key_configured ? "已配置（留空保持不变）" : "sk-..."}
            className="flex-1 rounded-md px-3 py-2 text-sm"
            style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
          />
          <button
            onClick={() => save({ deepseek_api_key: dsKey }, "API Key 已保存")}
            disabled={saving}
            className="hzx-btn !py-2 !px-3 !text-xs"
          >
            保存
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          当前状态：
          <span style={{ color: settings.deepseek_api_key_configured ? "var(--accent-green)" : "var(--accent-orange)" }}>
            {settings.deepseek_api_key_configured ? "已配置" : "未配置"}
          </span>
          ，密钥仅存于服务器 data/settings.json，页面不回显明文。
        </p>
      </div>

      {/* 成本计价 */}
      <div className="hzx-card">
        <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          💰 成本计价
        </h3>
        <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
          各 usage 缓存中 totalCost 为 0 的记录，将按以下单价估算成本（元 / 每 1M tokens，取自 DeepSeek v4-flash 空闲时段官方价）。
        </p>
        {pricing && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: "input", label: "输入（缓存未命中，元/1M）" },
              { key: "output", label: "输出（元/1M）" },
              { key: "cache_read", label: "输入（缓存命中，元/1M）" },
              { key: "cache_write", label: "缓存写 cacheWrite（元/1M）" },
              { key: "usd_to_rmb", label: "USD → RMB 汇率" },
            ].map((field) => (
              <div key={field.key}>
                <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
                  {field.label}
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={pricing[field.key as keyof Settings["pricing"]]}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setPricing({ ...pricing, [field.key]: Number.isFinite(v) ? v : 0 });
                  }}
                  className="w-full rounded-md px-3 py-2 text-sm"
                  style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => save({ pricing }, "成本计价已保存")}
            disabled={saving || !pricing}
            className="hzx-btn !py-2 !px-4 !text-sm"
          >
            {saving ? "保存中..." : "保存计价配置"}
          </button>
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            修改后点击保存即可生效
          </span>
        </div>
      </div>

      {/* DeepSeek 官方价格参考 */}
      <div className="hzx-card lg:col-span-2">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            💠 DeepSeek 官方价格参考
          </h3>
          {settings.deepseek_pricing && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--endspace-accent-dim)", color: "var(--accent-blue)" }}>
              {settings.deepseek_pricing.effective_date} 起生效
            </span>
          )}
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>
          单位：{settings.deepseek_pricing?.unit ?? "元/百万 tokens"}（{settings.deepseek_pricing?.currency ?? "CNY"}）。2026-08-17 起按新价计费；此前数据仍按各自原始价格，不受影响。
        </p>
        {settings.deepseek_pricing ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "var(--text-secondary)" }}>
                  <th className="text-left py-1.5 font-medium">模型</th>
                  <th className="text-left py-1.5 font-medium">时段</th>
                  <th className="text-right py-1.5 font-medium">输入（缓存命中）</th>
                  <th className="text-right py-1.5 font-medium">输入（缓存未命中）</th>
                  <th className="text-right py-1.5 font-medium">输出</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(settings.deepseek_pricing.models).map(([model, p]) => (
                  <Fragment key={model}>
                    {(["peak", "off_peak"] as const).map((period) => (
                      <tr key={period} className="border-t" style={{ borderColor: "var(--border-color)" }}>
                        {period === "peak" && (
                          <td rowSpan={2} className="py-2 pr-3 font-medium align-top" style={{ color: "var(--text-primary)" }}>
                            {model}
                          </td>
                        )}
                        <td className="py-2 pr-3" style={{ color: period === "peak" ? "var(--accent-orange)" : "var(--accent-green)" }}>
                          {period === "peak" ? "高峰时段" : "空闲时段"}
                        </td>
                        <td className="py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{p[period].cache_hit} 元</td>
                        <td className="py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{p[period].cache_miss} 元</td>
                        <td className="py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{p[period].output} 元</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>暂无价格配置</p>
        )}
      </div>

      {msg && (
        <p className="text-sm" style={{ color: msg.startsWith("保存失败") ? "var(--accent-red)" : "var(--accent-green)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
