import { getEnv } from "./env.ts";
import { sessionUser } from "./auth-server.ts";
import { foreignResource, loadRequestSpace } from "./spaces.ts";
import { getDb } from "./db.ts";

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

export function fail(status: number, error: string, extra?: Record<string, unknown>): Response {
  return json({ ok: false, error, ...extra }, status);
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** 认证：Bearer 令牌（守护进程与脚本），或用户登录会话（浏览器）。失败返回 null。 */
export async function authRole(req: Request): Promise<"admin" | "daemon" | null> {
  const env = getEnv();
  const t = bearer(req);
  if (t) {
    if (env.LOOP_ADMIN_TOKEN && t === env.LOOP_ADMIN_TOKEN) return "admin";
    if (env.LOOP_DAEMON_TOKEN && t === env.LOOP_DAEMON_TOKEN) return "daemon";
    return null;
  }
  if (await sessionUser(req.headers, new URL(req.url).origin)) return "admin";
  return null;
}

/** 页面请求选定空间，并拒绝跨空间按 id 读取。守护进程不经过这里。 */
async function pinSpace(req: Request): Promise<Response | null> {
  const token = bearer(req);
  let userId: string | null = null;
  if (!token) {
    userId = (await sessionUser(req.headers, new URL(req.url).origin))?.id ?? null;
  } else if (token === getEnv().LOOP_ADMIN_TOKEN) {
    // 本地网关换成云端令牌转发，并用 x-loop-user 带上登录邮箱
    const email = req.headers.get("x-loop-user")?.trim().toLowerCase();
    if (email) {
      const db = await getDb();
      const row = await db.prepare(`SELECT id FROM "user" WHERE lower(email)=?`).bind(email).first<{ id: string }>();
      userId = row?.id ?? null;
    }
  }
  const spaceId = await loadRequestSpace(req, userId);
  const db = await getDb();
  if (await foreignResource(db, spaceId, new URL(req.url).pathname)) return fail(404, "不存在");
  return null;
}

export async function requireRole(req: Request, role: "admin" | "daemon"): Promise<Response | null> {
  const got = await authRole(req);
  if (got === null) return fail(401, "未认证");
  if (got !== role) return fail(403, `需要 ${role} 权限`);
  if (role === "admin") {
    const blocked = await pinSpace(req);
    if (blocked) return blocked;
  }
  return null;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
