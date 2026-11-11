import { getEnv } from "./env.ts";

/**
 * 校验后台通知使用的公开地址。
 * 只拒绝真正有害的形态：非 http(s)、带凭证、带查询串或锚点。
 * 是否用 HTTPS 由部署者决定，不在这里强制——自建服务器常常先用 IP + 端口跑通。
 */
export function publicOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("LOOP_PUBLIC_URL 需要填写 http(s) 网关地址");
  }
  return url.origin;
}

/**
 * 请求对应的对外 origin。协议判断顺序：反代给的头 → 对外地址配置 → 请求自身。
 * 不要按主机名猜 https：公网 IP + HTTP 直接部署时会把 http 猜成 https，
 * 导致登录后的会话校验用错 baseURL 而一律判为未登录。
 */
export function requestOrigin(headers: Headers, host: string): string {
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const proto = forwarded === "http" || forwarded === "https"
    ? forwarded
    : safePublicProto() ?? "http";
  return `${proto}://${host}`;
}

/** LOOP_PUBLIC_URL 的协议；配错或不是合法 URL 时返回 null，由调用方回退。 */
function safePublicProto(): string | null {
  try {
    return new URL(getEnv().LOOP_PUBLIC_URL).protocol.replace(":", "");
  } catch {
    return null;
  }
}
