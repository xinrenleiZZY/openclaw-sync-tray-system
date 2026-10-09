/**
 * 数字格式化工具
 */

export function fmtTokens(n: number): string {
  if (!n) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function fmtUSD(n: number): string {
  return `$${(n || 0).toFixed(4)}`;
}

export function fmtRMB(n: number, rate = 7.2): string {
  return `¥${(n || 0) * rate} `.trim() + `(¥${((n || 0) * rate).toFixed(2)})`;
}

export function fmtCost(n: number): string {
  return `$${(n || 0).toFixed(4)}`;
}

export function fmtCNY(n: number): string {
  return `¥${(n || 0).toFixed(4)}`;
}

export function shortPath(p: string): string {
  if (!p) return "-";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? parts.slice(-3).join("/") : p;
}
