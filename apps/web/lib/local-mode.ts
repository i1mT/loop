// 本地模式配置：本地网关不存数据，把 /api/* 转发到云端。配置是一个 JSON secret（LOOP_LOCAL）。
export interface LocalConfig {
  /** 云端网关地址，例如 https://loop.example.com */
  upstream: string;
  /** 云端管理令牌（只在服务端使用，不进浏览器） */
  upstreamToken: string;
  /** 本机的机器 ID，与本机守护进程的 LOOPD_MACHINE_ID 一致 */
  machineId: string | null;
}

/** 空、{} 或格式不对都视为云端（返回 null）；只有同时给出上游地址与令牌才是本地模式 */
export function parseLocalConfig(raw: string | undefined | null): LocalConfig | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.upstream !== "string" || !/^https?:\/\//.test(o.upstream)) return null;
  if (typeof o.upstreamToken !== "string" || !o.upstreamToken) return null;
  return { upstream: o.upstream, upstreamToken: o.upstreamToken, machineId: typeof o.machineId === "string" && o.machineId ? o.machineId : null };
}
