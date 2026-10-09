"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { useState } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "仪表盘", icon: "📊" },
  { href: "/bigscreen", label: "可视化大屏", icon: "📺" },
  { href: "/deepseek", label: "Deepseek 统计", icon: "🌀" },
  { href: "/deepseek/screen", label: "Deepseek 大屏", icon: "🎥" },
  { href: "/usage", label: "用量总览", icon: "📈" },
  { href: "/machines", label: "机器列表", icon: "🖥️" },
  { href: "/prices", label: "模型价格", icon: "💲" },
  { href: "/key-owners", label: "key归属人员", icon: "👤" },
  { href: "/abnormal", label: "异常机器", icon: "🚨" },
  { href: "/sessions", label: "会话明细", icon: "💬" },
  { href: "/pushes", label: "推送记录", icon: "📤" },
  { href: "/settings", label: "设置", icon: "⚙️" },
];

export default function NavSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => pathname === href;

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-3 left-3 z-50 lg:hidden flex items-center justify-center w-9 h-9 rounded-md"
        style={{ backgroundColor: "var(--bg-tertiary)", color: "var(--text-primary)" }}
        aria-label="Toggle menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {mobileOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-40 h-full w-64 transform transition-transform duration-200 ease-in-out overflow-hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
        style={{
          backgroundColor: "var(--bg-secondary)",
          borderRight: "1px solid var(--border-color)",
        }}
      >
        {/* Brand */}
        <div className="p-6">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ backgroundColor: "var(--accent-green)", color: "#fff" }}
            >
              M
            </div>
            <div>
              <h1
                className="text-base font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                模型健康监控中心
              </h1>
              <p
                className="text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                MHC V1.0.0
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-3 overflow-y-auto" style={{ height: "calc(100% - 150px)" }}>
          <ul className="space-y-1">
            {navItems.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-200 ${
                      active ? "font-semibold" : "font-normal"
                    }`}
                    style={{
                      backgroundColor: active ? "var(--bg-tertiary)" : "transparent",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      borderLeft: active ? "2px solid var(--endspace-accent)" : "2px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                        e.currentTarget.style.borderLeftColor = "var(--endspace-accent-dim)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.borderLeftColor = "transparent";
                      }
                    }}
                  >
                    <span className="text-lg">{item.icon}</span>
                    {item.href === "/dashboard" ? (
                      <span className="artistic-nav">{item.label}</span>
                    ) : (
                      item.label
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom section */}
        <div className="absolute bottom-0 left-0 right-0 p-4" style={{ borderTop: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", zIndex: 1 }}>
          <div className="flex items-center justify-between px-3">
            <button onClick={() => { setMobileOpen(false); router.push("/developer"); }}
              className="text-xs transition-opacity hover:opacity-70"
              style={{ color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer" }}>
              © IT-钟 · 个人中心
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}
