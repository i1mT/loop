import { getEnv } from "./env.ts";

/** 校验后台通知使用的公开地址，避免把链接发往默认或其他部署。 */
export function publicOrigin(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "LOOP_PUBLIC_URL 需要填写 HTTPS 网关根地址（本机允许 HTTP）",
    );
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
