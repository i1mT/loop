// 登录失败节流（单个 Worker 实例内的尽力而为）：同一 IP 与邮箱的组合，1 分钟内最多 8 次失败。
const WINDOW_MS = 60_000;
const MAX_FAILS = 8;
const fails = new Map<string, number[]>();

export function tooManyFailures(key: string, nowMs: number = Date.now()): boolean {
  const recent = (fails.get(key) ?? []).filter((t) => nowMs - t < WINDOW_MS);
  fails.set(key, recent);
  return recent.length >= MAX_FAILS;
}

export function recordFailure(key: string, nowMs: number = Date.now()): void {
  const recent = (fails.get(key) ?? []).filter((t) => nowMs - t < WINDOW_MS);
  recent.push(nowMs);
  fails.set(key, recent);
  if (fails.size > 5000) for (const k of fails.keys()) { fails.delete(k); if (fails.size < 2500) break; }
}

export function clearFailures(key: string): void {
  fails.delete(key);
}
