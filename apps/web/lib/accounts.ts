// 账号只能由超级管理员创建。新账号不进入任何空间，访问范围另一次分配。
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Db } from "./pg.ts";
import { now } from "./db.ts";
import { isSuperAdmin } from "./spaces.ts";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function createAccount(
  db: Db,
  input: { email: string; password?: string; spaceIds?: string[] },
): Promise<{ email: string; password: string }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("邮箱格式不对");
  const exists = await db.prepare(`SELECT id FROM "user" WHERE lower(email)=?`).bind(email).first();
  if (exists) throw new Error("这个邮箱已经有账号");
  const password = input.password?.trim() || randomBytes(15).toString("base64url");
  if (password.length < 8) throw new Error("密码至少 8 位");
  const spaceIds = [...new Set(input.spaceIds ?? [])];
  for (const spaceId of spaceIds) {
    const space = await db.prepare(`SELECT id FROM spaces WHERE id=?`).bind(spaceId).first();
    if (!space) throw new Error("有不存在的空间");
  }
  const id = randomUUID().replace(/-/g, "");
  const hash = await hashPassword(password);
  await db.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", role) VALUES (?, ?, ?, TRUE, 'member')`).bind(id, email.split("@")[0], email).run();
  await db
    .prepare(`INSERT INTO account (id, "accountId", "providerId", "userId", password) VALUES (?, ?, 'credential', ?, ?)`)
    .bind(randomUUID().replace(/-/g, ""), id, id, hash)
    .run();
  for (const spaceId of spaceIds) {
    await db
      .prepare(`INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?, ?, 'member', ?) ON CONFLICT (space_id, user_id) DO NOTHING`)
      .bind(spaceId, id, now())
      .run();
  }
  return { email, password };
}

export interface AccountView {
  email: string;
  name: string;
  role: string;
  spaces: { id: string; name: string }[];
}

export async function listAccounts(db: Db): Promise<AccountView[]> {
  const users = (await db.prepare(`SELECT id, email, name, role FROM "user" ORDER BY email`).all<{ id: string; email: string; name: string; role: string }>()).results;
  const links = (
    await db
      .prepare(`SELECT m.user_id, s.id, s.name FROM space_members m JOIN spaces s ON s.id = m.space_id ORDER BY s.created_at`)
      .all<{ user_id: string; id: string; name: string }>()
  ).results;
  return users.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    spaces: links.filter((l) => l.user_id === u.id).map((l) => ({ id: l.id, name: l.name })),
  }));
}

/** 覆盖这个账号能进入的空间。超级管理员不靠这份名单访问空间。 */
export async function setAccountSpaces(db: Db, email: string, spaceIds: string[]): Promise<void> {
  const user = await db.prepare(`SELECT id, email FROM "user" WHERE lower(email)=?`).bind(email.trim().toLowerCase()).first<{ id: string; email: string }>();
  if (!user) throw new Error("没有这个账号");
  if (await isSuperAdmin(db, user.id)) throw new Error("超级管理员可以进入全部空间，不用单独分配");
  const unique = [...new Set(spaceIds)];
  for (const spaceId of unique) {
    const space = await db.prepare(`SELECT id FROM spaces WHERE id=?`).bind(spaceId).first();
    if (!space) throw new Error("有不存在的空间");
  }
  await db.prepare(`DELETE FROM space_members WHERE user_id=?`).bind(user.id).run();
  for (const spaceId of unique) {
    await db
      .prepare(`INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`)
      .bind(spaceId, user.id, now())
      .run();
  }
}
