/**
 * 主题切换工具 - 亮色/暗色模式
 */

export type Theme = "light" | "dark";

export function getThemeFromCookie(cookie?: string): Theme {
  if (!cookie) return "light";
  const match = cookie.match(/theme=(light|dark)/);
  return (match?.[1] as Theme) || "light";
}

export function setThemeCookie(theme: Theme): void {
  document.cookie = `theme=${theme};path=/;max-age=${365 * 24 * 60 * 60}`;
}
