import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import NavSidebar from "@/components/NavSidebar";
import LoadingCover from "@/components/LoadingCover";
import VideoBackground from "@/components/VideoBackground";

export const metadata: Metadata = {
  title: "模型健康监控中心",
  description: "模型健康监控中心 - OpenClaw 多机用量采集与成本监控",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("theme")?.value || "light";

  return (
    <html lang="zh-CN" className={theme === "dark" ? "dark" : ""}>
      <body suppressHydrationWarning id="mhc-root">
        {/* ─── 加载动画 ─── */}
        <LoadingCover />

        {/* ─── 视频背景 ─── */}
        <VideoBackground />

        {/* ─── HUD 四角标记 ─── */}
        <div className="hud-corner-tl" />
        <div className="hud-corner-tr" />
        <div className="hud-corner-bl" />
        <div className="hud-corner-br" />

        {/* ─── 扫描线 ─── */}
        <div className="scan-vertical" />
        <div className="scan-horizontal" />

        <div className="min-h-screen" style={{ backgroundColor: "var(--bg-primary)" }}>
          <NavSidebar />
          <main className="lg:pl-64">
            <div className="mx-auto max-w-page px-4 py-6 sm:px-6 lg:px-8">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
