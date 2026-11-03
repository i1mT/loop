// 展示用的格式化函数（纯函数，便于测试）
export function timeAgo(ms: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 10) return "刚刚";
  if (s < 60) return `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ms).toLocaleDateString("zh-CN");
}

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
}

export const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 8) : "无");

export function plural(n: number, unit: string): string {
  return `${n} ${unit}`;
}
