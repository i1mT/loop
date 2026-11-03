// 集成测试：连真实的 Neon 开发分支。没有 DATABASE_URL 时跳过。
// 运行：pnpm run test:db（从 .env.local 读取连接串）
import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./pg.ts";
import { MIGRATIONS, migrate } from "./migrations.ts";

const url = process.env.DATABASE_URL;
const skip = url ? false : "没有 DATABASE_URL，跳过集成测试";

test("迁移可重复执行，版本号正确", { skip }, async () => {
  const db = new Db(url!);
  assert.equal(await migrate(db), MIGRATIONS.length);
  assert.equal(await migrate(db), MIGRATIONS.length, "第二次不应报错");
});

test("bigint 列返回数字，不是字符串；驼峰别名保持大小写", { skip }, async () => {
  const db = new Db(url!);
  await migrate(db);
  const id = `t-${Date.now()}`;
  const t = Date.now();
  await db.prepare(`INSERT INTO projects (id, name, repo_path, created_at) VALUES (?, ?, ?, ?)`).bind(id, "测试", "/x", t).run();
  const row = await db.prepare(`SELECT created_at AS "createdAt", created_at FROM projects WHERE id=?`).bind(id).first<{ createdAt: number; created_at: number }>();
  assert.equal(typeof row!.created_at, "number");
  assert.equal(row!.created_at, t);
  assert.equal(row!.createdAt, t);
  await db.prepare(`DELETE FROM projects WHERE id=?`).bind(id).run();
});

test("事件按 (session_id, seq) 幂等：重复写入只保留一份", { skip }, async () => {
  const db = new Db(url!);
  await migrate(db);
  const sid = `s-${Date.now()}`;
  const ins = () => db.prepare(`INSERT INTO session_events (session_id, seq, kind, payload, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (session_id, seq) DO NOTHING`).bind(sid, 0, "message", "{}", 1).run();
  await ins();
  await ins();
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM session_events WHERE session_id=?`).bind(sid).first<{ n: number }>();
  assert.equal(n!.n, 1);
  await db.prepare(`DELETE FROM session_events WHERE session_id=?`).bind(sid).run();
});

test("批量写入是事务：中途失败，前面的也回滚", { skip }, async () => {
  const db = new Db(url!);
  await migrate(db);
  const id = `tx-${Date.now()}`;
  await assert.rejects(() =>
    db.batch([
      db.prepare(`INSERT INTO projects (id, name, repo_path, created_at) VALUES (?, ?, ?, ?)`).bind(id, "x", "/x", 1),
      db.prepare(`INSERT INTO no_such_table (a) VALUES (1)`),
    ]),
  );
  const row = await db.prepare(`SELECT id FROM projects WHERE id=?`).bind(id).first();
  assert.equal(row, null, "事务回滚后不应留下记录");
});

test("自增主键返回数字，且 first 无结果时为 null", { skip }, async () => {
  const db = new Db(url!);
  await migrate(db);
  assert.equal(await db.prepare(`SELECT id FROM inbox WHERE id=?`).bind(-1).first(), null);
  await db.prepare(`INSERT INTO inbox (session_id, kind, body, created_at) VALUES (?, 'message', 'x', ?)`).bind("sid-pg", 1).run();
  const r = await db.prepare(`SELECT id FROM inbox WHERE session_id=? ORDER BY id DESC LIMIT 1`).bind("sid-pg").first<{ id: number }>();
  assert.equal(typeof r!.id, "number");
  await db.prepare(`DELETE FROM inbox WHERE session_id=?`).bind("sid-pg").run();
});

test("从空库一路迁移到最新（新部署走的路径）", { skip }, async () => {
  const admin = new Db(url!);
  const name = `mig_${Date.now()}`;
  await admin.prepare(`CREATE DATABASE ${name}`).run();
  try {
    const u = new URL(url!);
    u.pathname = `/${name}`;
    const fresh = new Db(u.toString());
    assert.equal(await migrate(fresh), MIGRATIONS.length);
    const tables = (await fresh.prepare(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`).all<{ table_name: string }>()).results.map((r) => r.table_name);
    for (const t of ["machines", "machine_agents", "projects", "tasks", "leases", "sessions", "session_events", "inbox", "notifications", "daemon_claude_sessions", "kv"]) {
      assert.ok(tables.includes(t), `缺少表 ${t}`);
    }
    assert.ok(!tables.includes("agents_local"), "agents_local 应已并入 machines");
    const cols = (await fresh.prepare(`SELECT column_name FROM information_schema.columns WHERE table_name='projects'`).all<{ column_name: string }>()).results.map((r) => r.column_name);
    for (const c of ["github_repo", "machine_id", "agent", "local_path"]) assert.ok(cols.includes(c), `projects 缺少列 ${c}`);
  } finally {
    await admin.prepare(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).run();
  }
});
