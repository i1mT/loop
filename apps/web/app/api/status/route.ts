import { json, requireRole } from "@/lib/http.ts";
import { configuredPublicOrigin, requestOrigin, upstreamPublicOrigin } from "@/lib/public-url.ts";
import { sessionUser } from "@/lib/auth-server.ts";
import { getEnv } from "@/lib/env.ts";
import { parseLocalConfig } from "@/lib/local-mode.ts";

// 当前网关的运行模式与版本；同时用作“已登录”检查。
// 本地模式额外返回云端地址（不含令牌）与本机机器 ID，页面据此显示“本机”。
export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const local = parseLocalConfig(getEnv().LOOP_LOCAL);
  const origin = requestOrigin(req.headers, req.headers.get("host") ?? new URL(req.url).host);
  const user = await sessionUser(req.headers, origin);
  const base = local ? await upstreamPublicOrigin(local) : configuredPublicOrigin() ?? origin;
  return json({
    ok: true,
    mode: local ? "local" : "cloud",
    host: new URL(req.url).host,
    base,
    upstream: local ? new URL(local.upstream).host : null,
    machineId: local?.machineId ?? null,
    user: user ? { email: user.email, name: user.name } : null,
    version: "0.1.0",
  });
}
