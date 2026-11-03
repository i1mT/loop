import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./pg.ts";
import { migrate } from "./migrations.ts";
import { useDb } from "./db.ts";
import { isSuperAdmin, removeMember } from "./spaces.ts";
import { setAccountSpaces } from "./accounts.ts";

test(
  "自托管角色：示例邮箱没有特权，任意显式 super 账号均受保护",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = new Db(process.env.DATABASE_URL!);
    await migrate(db);
    useDb(db);
    const id = `roles-${crypto.randomUUID()}`;
    const email = `${id}@example.org`;
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO "user" (id,name,email,role) VALUES (?,?,'admin@example.com','member')`,
          )
          .bind(id, "Example"),
        db
          .prepare(
            `INSERT INTO "user" (id,name,email,role) VALUES (?, ?,?,'super')`,
          )
          .bind(id + "-super", "Owner", email),
        db
          .prepare(
            `INSERT INTO spaces(id,name,created_at) VALUES (?, 'Role test', ?)`,
          )
          .bind(id, Date.now()),
        db
          .prepare(
            `INSERT INTO space_members(space_id,user_id,role,created_at) VALUES (?,?,'owner',?)`,
          )
          .bind(id, id + "-super", Date.now()),
      ]);
      assert.equal(await isSuperAdmin(db, id), false);
      assert.equal(await isSuperAdmin(db, id + "-super"), true);
      await assert.rejects(() => setAccountSpaces(db, email, []), /超级管理员/);
      assert.equal((await removeMember(db, id, email)).ok, false);
    } finally {
      await db.batch([
        db.prepare(`DELETE FROM space_members WHERE space_id=?`).bind(id),
        db.prepare(`DELETE FROM spaces WHERE id=?`).bind(id),
        db
          .prepare(`DELETE FROM "user" WHERE id IN (?,?)`)
          .bind(id, id + "-super"),
      ]);
    }
  },
);
