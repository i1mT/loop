"use client";
// 客户端数据获取：同源 /api/*；带缓存（切页面立即显示旧数据再刷新）、轮询、统一错误。
// 页面一律走这里取数据，这样本地 web 只需要把 /api/* 转发到云端。
import { useCallback, useEffect, useReducer } from "react";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const SPACE_STORAGE = "loop_space";

function spaceHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const id = localStorage.getItem(SPACE_STORAGE);
  return id ? { "x-loop-space": id } : {};
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...spaceHeader(), ...init?.headers } });
  } catch {
    throw new ApiError(0, "无法连接到网关，请检查网络");
  }
  if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = "/login";
  }
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || (data && data.ok === false)) throw new ApiError(res.status, data?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

export const apiGet = <T,>(path: string) => request<T>(path);
export const apiPatch = <T = { ok: true }>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const apiPut = <T = { ok: true }>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const apiDelete = <T = { ok: true }>(path: string) => request<T>(path, { method: "DELETE" });
export const apiPost = <T = { ok: true }>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

interface Entry {
  data?: unknown;
  error?: ApiError;
  at: number;
  inflight?: Promise<void>;
  subs: Set<() => void>;
}
const cache = new Map<string, Entry>();

function entryOf(path: string): Entry {
  let e = cache.get(path);
  if (!e) {
    e = { at: 0, subs: new Set() };
    cache.set(path, e);
  }
  return e;
}

function load(path: string): Promise<void> {
  const e = entryOf(path);
  if (e.inflight) return e.inflight;
  e.inflight = request<unknown>(path)
    .then((d) => {
      e.data = d;
      e.error = undefined;
    })
    .catch((err: ApiError) => {
      e.error = err;
    })
    .finally(() => {
      e.at = Date.now();
      e.inflight = undefined;
      e.subs.forEach((f) => f());
    });
  e.subs.forEach((f) => f());
  return e.inflight;
}

/** 让以某前缀开头的所有已缓存请求重新加载（写操作之后调用） */
export function mutate(prefix: string): void {
  for (const [path, e] of cache) if (path.startsWith(prefix) && e.subs.size > 0) void load(path);
}

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  /** 第一次加载且还没有任何数据 */
  loading: boolean;
  /** 正在后台刷新 */
  refreshing: boolean;
  reload: () => void;
}

export function useApi<T>(path: string | null, opts: { poll?: number } = {}): ApiState<T> {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const poll = opts.poll;
  useEffect(() => {
    if (!path) return;
    const e = entryOf(path);
    e.subs.add(bump);
    if (!e.data || Date.now() - e.at > 2000) void load(path);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (poll) timer = setInterval(() => document.visibilityState === "visible" && void load(path), poll);
    const onVisible = () => document.visibilityState === "visible" && Date.now() - entryOf(path).at > 2000 && void load(path);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      e.subs.delete(bump);
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, poll]);
  const reload = useCallback(() => path && void load(path), [path]);
  const e = path ? cache.get(path) : undefined;
  return { data: e?.data as T | undefined, error: e?.error, loading: !!path && !e?.data && !e?.error, refreshing: !!e?.inflight, reload };
}
