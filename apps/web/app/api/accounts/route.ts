import { createAccount, listAccounts, setAccountSpaces } from "@/lib/accounts.ts";
import { getDb } from "@/lib/db.ts";
import { getEnv } from "@/lib/env.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { sessionUser } from "@/lib/auth-server.ts";
import { isSuperAdmin } from "@/lib/spaces.ts";

async function actorId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return (await sessionUser(req.headers, new URL(req.url).origin))?.id ?? null;
  if (token !== getEnv().LOOP_ADMIN_TOKEN) return null;
  const email = req.headers.get("x-loop-user")?.trim().toLowerCase();
  if (!email) return null;
  const row = await (await getDb()).prepare(`SELECT id FROM "user" WHERE lower(email)=?`).bind(email).first<{ id: string }>();
  return row?.id ?? null;
}

export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const userId = await actorId(req);
  const db = await getDb();
  if (!userId || !(await isSuperAdmin(db, userId))) return fail(403, "只有超级管理员可以查看账号");
  return json({ ok: true, accounts: await listAccounts(db) });
}

export async function PUT(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const userId = await actorId(req);
  const db = await getDb();
  if (!userId || !(await isSuperAdmin(db, userId))) return fail(403, "只有超级管理员可以分配空间");
  const body = await readJson<{ email?: string; spaceIds?: string[] }>(req);
  if (!body?.email || !body.spaceIds) return fail(400, "需要 email 与 spaceIds");
  try {
    await setAccountSpaces(db, body.email, body.spaceIds);
    return json({ ok: true });
  } catch (e) {
    return fail(400, (e as Error).message);
  }
}

/** 超级管理员创建登录账号，并指定能进入的空间。不开放自行注册。 */
export async function POST(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const userId = await actorId(req);
  const db = await getDb();
  if (!userId || !(await isSuperAdmin(db, userId))) return fail(403, "只有超级管理员可以创建账号");
  const body = await readJson<{ email?: string; password?: string; spaceIds?: string[] }>(req);
  if (!body?.email) return fail(400, "需要邮箱");
  try {
    const account = await createAccount(db, { email: body.email, password: body.password, spaceIds: body.spaceIds });
    return json({ ok: true, account }, 201);
  } catch (e) {
    return fail(400, (e as Error).message);
  }
}
