// 本地模式的转发规则（纯函数，便于测试）：页面所在的本地网关不存数据，
// 把 /api/* 原样转发到云端，并在服务端附上云端令牌（令牌不进浏览器）。

/** 在本地网关自己处理的路径（登录用本机令牌；状态是本地信息）。其余 /api/* 全部转发。 */
const LOCAL_ONLY = new Set(["/api/login", "/api/logout", "/api/status", "/api/account/password", "/api/health"]);

export function shouldForward(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (LOCAL_ONLY.has(pathname)) return false;
  return true;
}

/** 守护进程接口不经本地网关：守护进程直接连云端 */
export function isDaemonPath(pathname: string): boolean {
  return pathname.startsWith("/api/daemon/");
}

export function upstreamUrl(base: string, pathname: string, search: string): string {
  return `${base.replace(/\/+$/, "")}${pathname}${search}`;
}

/** 只带必要的头；浏览器的 cookie、host 等一律不转发，认证换成云端令牌 */
export function upstreamHeaders(incoming: Headers, token: string): Headers {
  const h = new Headers();
  const ct = incoming.get("content-type");
  if (ct) h.set("content-type", ct);
  const accept = incoming.get("accept");
  if (accept) h.set("accept", accept);
  h.set("authorization", `Bearer ${token}`);
  // 当前空间由浏览器选出。本地网关换成云端令牌后，云端靠这个头知道看哪个空间。
  const space = incoming.get("x-loop-space");
  if (space) h.set("x-loop-space", space);
  const who = incoming.get("x-loop-user");
  if (who) h.set("x-loop-user", who);
  return h;
}
