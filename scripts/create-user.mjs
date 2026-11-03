#!/usr/bin/env node
// 创建账号或重置密码。首次部署通过 --super 显式创建超级管理员。
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { localConfig } from "./lib/config.mjs";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { hashPassword } = require("better-auth/crypto");
const { neon } = require("@neondatabase/serverless");
const args = process.argv.slice(2);
const makeSuper = args.includes("--super");
const positional = args.filter((value) => value !== "--super");
const email = positional[0]?.trim().toLowerCase();
if (
  !email ||
  !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
  positional.length > 2
) {
  console.error("用法：node scripts/create-user.mjs <邮箱> [密码] [--super]");
  process.exit(1);
}
const url = process.env.DATABASE_URL ?? localConfig().DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL，请指定目标数据库并先运行迁移。");
  process.exit(1);
}
const password = positional[1] ?? randomBytes(18).toString("base64url");
if (password.length < 8 || password.length > 128) {
  console.error("密码需要 8 至 128 位");
  process.exit(1);
}
const sql = neon(url);
const hash = await hashPassword(password);
const existing = await sql`SELECT id FROM "user" WHERE lower(email) = ${email}`;
if (existing.length) {
  const id = existing[0].id;
  await sql.transaction([
    sql`UPDATE account SET password = ${hash}, "updatedAt" = NOW() WHERE "userId" = ${id} AND "providerId" = 'credential'`,
    sql`DELETE FROM session WHERE "userId" = ${id}`,
    ...(makeSuper ? [sql`UPDATE "user" SET role='super' WHERE id=${id}`] : []),
  ]);
  console.log(`已经重置账号密码并使原登录失效：${email}`);
} else {
  const id = randomUUID().replace(/-/g, "");
  const role = makeSuper ? "super" : "member";
  await sql.transaction([
    sql`INSERT INTO "user" (id, name, email, "emailVerified", role) VALUES (${id}, ${email.split("@")[0]}, ${email}, TRUE, ${role})`,
    sql`INSERT INTO account (id, "accountId", "providerId", "userId", password) VALUES (${randomUUID().replace(/-/g, "")}, ${id}, 'credential', ${id}, ${hash})`,
  ]);
  console.log(`已经创建${makeSuper ? "超级管理员" : "普通账号"}：${email}`);
}
console.log(`密码：${password}`);
