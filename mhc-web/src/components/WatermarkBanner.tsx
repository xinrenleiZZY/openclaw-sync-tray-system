"use client";

import { useState, useEffect } from "react";

/**
 * WatermarkBanner - 顶部水印滚动横幅
 * artistic：标题渲染为艺术彩字（逐字渐变流光），悬浮更亮
 * onClick：标题可点击（如切换到仪表盘"生命形态"）
 */
export default function WatermarkBanner({
  title = "仪表盘",
  artistic = false,
  onClick,
}: {
  title?: string;
  artistic?: boolean;
  onClick?: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const ART_COLORS = ["#22d3ee", "#34d399", "#fbbf24", "#a78bfa", "#f87171"];

  return (
    <div className="relative mb-6 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border-color)" }}>
      <div
        className="pointer-events-none absolute inset-0 flex items-center overflow-hidden opacity-[0.06]"
        style={{ fontFamily: "'JetBrains Mono', 'Consolas', monospace" }}
      >
        <div className="animate-marquee whitespace-nowrap">
          <span className="select-none text-[6rem] font-black leading-none" style={{ color: "var(--text-primary)" }}>
            MHC_MONITOR<span className="mx-[4vw]" style={{ color: "var(--text-tertiary)" }}>◆</span>
            MHC_MONITOR<span className="mx-[4vw]" style={{ color: "var(--text-tertiary)" }}>◆</span>
            MHC_MONITOR<span className="mx-[4vw]" style={{ color: "var(--text-tertiary)" }}>◆</span>
            MHC_MONITOR<span className="mx-[4vw]" style={{ color: "var(--text-tertiary)" }}>◆</span>
            MHC_MONITOR<span className="mx-[4vw]" style={{ color: "var(--text-tertiary)" }}>◆</span>
          </span>
        </div>
      </div>

      <div className="relative z-10 px-6 py-8">
        {artistic ? (
          <div
            className="artistic-title inline-block"
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onClick) onClick();
            }}
          >
            <h1 className="text-2xl font-bold">
              {title.split("").map((ch, i) => (
                <span
                  key={i}
                  className="artistic-char"
                  style={{ animationDelay: `${i * 0.35}s`, color: ART_COLORS[i % ART_COLORS.length] }}
                >
                  {ch}
                </span>
              ))}
            </h1>
            <p className="text-[11px] mt-1 tracking-widest" style={{ color: "var(--text-tertiary)" }}>
              ✦ 点击进入「生命形态」实时解析
            </p>
          </div>
        ) : (
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h1>
        )}
        <div className="mt-2 h-0.5 w-16" style={{ background: "var(--endspace-accent)" }} />
      </div>

      <style jsx>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 20s linear infinite;
        }
      `}</style>
    </div>
  );
}
