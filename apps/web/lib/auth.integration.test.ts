// 集成测试：对真实 Postgres（Neon dev 分支）验证 better-auth 登录流程。没有 DATABASE_URL 时跳过。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { hashPassword } from "better-auth/crypto";
import { Db } from "./pg.ts";
import { migrate } from "./migrations.ts";
import { createAuth } from "./auth-factory.ts";

const url = process.env.DATABASE_URL;
const skip = url ? false : "没有 DATABASE_URL，跳过集成测试";
neonConfig.webSocketConstructor = ws;

const email = `t${Date.now()}@example.com`;
const password = "correct-horse-battery";
let db: Db | null = null;
const handles: { close: () => Promise<unknown> }[] = [];
const mk = () => {
  const h = createAuth({ databaseUrl: url!, secret: "test-secret-test-secret-test-secret-0123", baseURL: "http://localhost:5190" });
  handles.push(h);
  return h.auth;
};

after(async () => {
  for (const h of handles) await h.close();
  if (db) await db.prepare(`DELETE FROM "user" WHERE email=?`).bind(email).run();
});

async function seed() {
  db = new Db(url!);
  await migrate(db);
  const id = randomUUID().replace(/-/g, "");
  await db.prepare(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES (?, ?, ?, TRUE)`).bind(id, "t", email).run();
  await db.prepare(`INSERT INTO account (id, "accountId", "providerId", "userId", password) VALUES (?, ?, 'credential', ?, ?)`).bind(randomUUID().replace(/-/g, ""), id, id, await hashPassword(password)).run();
}

test("账号登录、会话校验、错误密码、禁止注册、修改密码", { skip }, async () => {
  await seed();
  const auth = mk();

  const bad = await auth.api.signInEmail({ body: { email, password: "wrong-password" }, asResponse: true });
  assert.equal(bad.ok, false, "错误密码不能登录");

  const ok = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  assert.equal(ok.ok, true);
  const cookies = ok.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  assert.match(cookies, /better-auth\.session_token=/);

  const sess = await auth.api.getSession({ headers: new Headers({ cookie: cookies }) });
  assert.equal(sess?.user.email, email);
  assert.equal(await auth.api.getSession({ headers: new Headers() }), null, "没有 cookie 就是未登录");
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: "better-auth.session_token=forged.value" }) }), null, "伪造的 cookie 无效");

  await assert.rejects(() => auth.api.signUpEmail({ body: { email: `x${email}`, password: "another-password-1", name: "x" } }), "不开放注册");

  const changed = await auth.api.changePassword({ body: { currentPassword: password, newPassword: "brand-new-password-9", revokeOtherSessions: true }, headers: new Headers({ cookie: cookies }), asResponse: true });
  assert.equal(changed.ok, true);
  const relogin = await auth.api.signInEmail({ body: { email, password: "brand-new-password-9" }, asResponse: true });
  assert.equal(relogin.ok, true, "新密码可以登录");
  const old = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  assert.equal(old.ok, false, "旧密码失效");
});
