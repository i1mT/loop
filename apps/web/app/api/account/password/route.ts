import { fail, json, readJson } from "@/lib/http.ts";
import { isLocalMode, sessionUser, withAuth } from "@/lib/auth-server.ts";
import { requestOrigin } from "@/lib/public-url.ts";

// 修改当前登录用户的密码（仅云端）。成功后其它设备上的会话全部失效。
export async function POST(req: Request) {
  if (isLocalMode()) return fail(400, "请在云端网页里修改密码");
  const origin = requestOrigin(req.headers, req.headers.get("host") ?? new URL(req.url).host);
  if (!(await sessionUser(req.headers, origin))) return fail(401, "未认证");
  const body = await readJson<{ currentPassword?: string; newPassword?: string }>(req);
  if (!body?.currentPassword || !body.newPassword) return fail(400, "需要当前密码和新密码");
  if (body.newPassword.length < 8) return fail(400, "新密码至少 8 位");
  const res = await withAuth(origin, (auth) => auth.api.changePassword({ body: { currentPassword: body.currentPassword!, newPassword: body.newPassword!, revokeOtherSessions: true }, headers: req.headers, asResponse: true }).catch(() => null));
  if (!res || !res.ok) return fail(400, "当前密码不正确");
  return json({ ok: true });
}
