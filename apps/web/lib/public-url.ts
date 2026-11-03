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
