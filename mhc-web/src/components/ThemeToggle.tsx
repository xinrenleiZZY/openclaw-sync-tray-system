"use client";

import { useCallback, useEffect, useState } from "react";
import { setThemeCookie } from "@/lib/theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setDark(isDark);
  }, []);

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    setThemeCookie(next ? "dark" : "light");
  }, [dark]);

  return (
    <button
      onClick={toggle}
      className="hzx-btn !py-1 !px-3 !text-xs"
      aria-label="Toggle theme"
    >
      {dark ? "☀️ 亮色" : "🌙 深色"}
    </button>
  );
}
