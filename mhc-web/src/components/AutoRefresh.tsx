"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 页面自动刷新（默认 30 秒调用 router.refresh 重新拉取 Server Component 数据）
 */
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  return (
    <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
      每 {seconds}s 自动刷新
    </span>
  );
}
