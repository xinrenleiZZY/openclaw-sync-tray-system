"use client";

import { useState, useEffect } from "react";

/**
 * Video Background Component
 * 白天显示视频背景，夜间模式自动隐藏
 */
export default function VideoBackground() {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  if (!mounted) return null;

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <video
        autoPlay
        muted
        loop
        playsInline
        className="h-full w-full object-cover opacity-[0.08] dark:opacity-0"
        style={{ filter: "blur(4px) scale(1.05)" }}
      >
        <source
          src={process.env.NEXT_PUBLIC_BG_VIDEO || "/bg-video.mp4"}
          type="video/mp4"
        />
      </video>
    </div>
  );
}
