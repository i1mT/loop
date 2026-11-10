import { sessionUser } from "../auth-server.ts";
import { requestOrigin } from "@/lib/public-url.ts";
import { getEnv } from "../env.ts";
import { getDb } from "../db.ts";
import { requireRole, fail } from "../http.ts";
import { isSuperAdmin, requestSpace } from "../spaces.ts";
export async function feishuAccess(req: Request, manage = false) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const db = await getDb(),
    spaceId = requestSpace(req);
  if (!spaceId || spaceId === "space_none") return fail(400, "请先选择空间");
  const session = await sessionUser(req.headers, requestOrigin(req.headers, req.headers.get("host") ?? new URL(req.url).host));
  let userId = session?.id ?? null;
  const bearer = req.headers.get("authorization");
  const email =
    session?.email ??
    (bearer === `Bearer ${getEnv().LOOP_ADMIN_TOKEN}`
      ? req.headers.get("x-loop-user")
      : null);
  if (!userId && email)
    userId =
      (
        await db
          .prepare('SELECT id FROM "user" WHERE lower(email)=?')
          .bind(email.toLowerCase())
          .first<{ id: string }>()
      )?.id ?? null;
  const member = userId
    ? await db
        .prepare(
          "SELECT role FROM space_members WHERE space_id=? AND user_id=?",
        )
        .bind(spaceId, userId)
        .first<{ role: string }>()
    : null;
  const canManage =
    !!userId && ((await isSuperAdmin(db, userId)) || member?.role === "owner");
  if (!userId) return fail(403, "请登录账号后配置飞书");
  if (manage && !canManage) return fail(403, "只有空间负责人可以配置飞书");
  return { db, spaceId, userId, canManage };
}
