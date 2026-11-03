import { fail, json, readJson } from "@/lib/http.ts";
import { isLocalMode, withAuth } from "@/lib/auth-server.ts";
import { getEnv } from "@/lib/env.ts";
import { parseLocalConfig } from "@/lib/local-mode.ts";
import { LOCAL_COOKIE, signLocalSession } from "@/lib/local-session.ts";
import { clearFailures, recordFailure, tooManyFailures } from "@/lib/login-throttle.ts";

// 邮箱 + 密码登录。云端用 better-auth；本地模式把凭据交给云端验证，通过后签发本机 cookie。
export async function POST(req: Request) {
  const body = await readJson<{ email?: string; password?: string }>(req);
  const email = body?.email?.trim().toLowerCase();
  if (!email || !body?.password) return fail(400, "需要邮箱和密码");
  const key = `${req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local"}|${email}`;
  if (tooManyFailures(key)) return fail(429, "尝试次数过多，请一分钟后再试");

  const origin = new URL(req.url).origin;
  const secure = origin.startsWith("https:") ? "; Secure" : "";

  if (isLocalMode()) {
    const local = parseLocalConfig(getEnv().LOOP_LOCAL)!;
    let res: Response;
    try {
      res = await fetch(`${local.upstream.replace(/\/+$/, "")}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: body.password }) });
    } catch {
      return fail(502, "无法连接到云端，请检查网络");
    }
    if (res.status === 429) return fail(429, "尝试次数过多，请一分钟后再试");
    if (!res.ok) {
      recordFailure(key);
      return fail(401, "邮箱或密码不正确");
    }
    clearFailures(key);
    const value = await signLocalSession(getEnv().LOOP_ADMIN_TOKEN, email);
    return json({ ok: true, user: { email } }, 200, { "set-cookie": `${LOCAL_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}` });
  }

  const res = await withAuth(origin, (auth) => auth.api.signInEmail({ body: { email, password: body.password! }, headers: req.headers, asResponse: true }).catch(() => null));
  if (!res || !res.ok) {
    recordFailure(key);
    return fail(401, "邮箱或密码不正确");
  }
  clearFailures(key);
  const data = (await res.json()) as { user?: { email: string; name: string } };
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  for (const c of res.headers.getSetCookie()) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true, user: { email: data.user?.email ?? email, name: data.user?.name } }), { status: 200, headers });
}
