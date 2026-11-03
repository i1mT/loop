/** 来源的允许站点校验。rules 为空表示不限制；支持 https://*.example.com 形式的通配 */
export function originAllowed(origin: string, allowed: string | null): boolean {
  const rules = (allowed ?? "").split(/[\s,]+/).filter(Boolean);
  if (!rules.length) return true;
  return rules.some((r) => {
    if (r === "*") return true;
    if (r.includes("*")) {
      const re = new RegExp("^" + r.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+") + "$");
      return re.test(origin);
    }
    return origin === r.replace(/\/$/, "");
  });
}

/** 允许的站点才回 Access-Control-Allow-Origin；没有 Origin（脚本调用）只在没限制站点时放行 */
export function corsHeaders(origin: string | null, source: { allowed_origins: string | null } | null): Record<string, string> {
  const ok = !source || (origin ? originAllowed(origin, source.allowed_origins) : !source.allowed_origins);
  return {
    ...(ok && origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
