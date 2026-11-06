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

import { MACHINE_ACCESS_SCHEMA } from "./machine-access/schema.ts";

test("旧机器归属只使用唯一显式超级管理员，重复迁移不修改现有权限", {skip:!process.env.DATABASE_URL}, async()=>{
  const db=new Db(process.env.DATABASE_URL!);
  const schema=`migration_${crypto.randomUUID().replaceAll('-','')}`;
  await db.prepare(`CREATE SCHEMA ${schema}`).run();
  const scoped=(queries:string[])=>db.batchReturning([db.prepare(`SET LOCAL search_path TO ${schema}`),...queries.map(q=>db.prepare(q))]);
  try{
    await scoped([
      `CREATE TABLE "user"(id TEXT PRIMARY KEY,role TEXT NOT NULL)`,
      `CREATE TABLE machines(id TEXT PRIMARY KEY)`,
      `CREATE TABLE space_machines(machine_id TEXT,shared INTEGER DEFAULT 0)`,
      `INSERT INTO "user" VALUES('member','member')`,
      `INSERT INTO machines VALUES('old')`,
      `INSERT INTO space_machines VALUES('old',0)`,
      ...MACHINE_ACCESS_SCHEMA,
    ]);
    let result=await scoped([`SELECT owner_user_id,legacy_auth FROM machines WHERE id='old'`]);
    assert.deepEqual(result.at(-1)!.rows,[{owner_user_id:null,legacy_auth:0}]);
    await scoped([`INSERT INTO "user" VALUES('owner','super')`,...MACHINE_ACCESS_SCHEMA]);
    result=await scoped([`SELECT owner_user_id,legacy_auth FROM machines WHERE id='old'`,`SELECT shared FROM space_machines WHERE machine_id='old'`]);
    assert.deepEqual(result.at(-2)!.rows,[{owner_user_id:'owner',legacy_auth:1}]);
    assert.deepEqual(result.at(-1)!.rows,[{shared:1}]);
    await scoped([
      `UPDATE machines SET owner_user_id='member',credential_hash='existing',legacy_auth=0 WHERE id='old'`,
      `UPDATE space_machines SET shared=0 WHERE machine_id='old'`,
      `INSERT INTO "user" VALUES('second','super')`,
      `INSERT INTO machines(id) VALUES('unowned')`,
      ...MACHINE_ACCESS_SCHEMA,
    ]);
    result=await scoped([`SELECT owner_user_id,credential_hash,legacy_auth FROM machines WHERE id='old'`,`SELECT owner_user_id,legacy_auth FROM machines WHERE id='unowned'`,`SELECT shared FROM space_machines WHERE machine_id='old'`]);
    assert.deepEqual(result.at(-3)!.rows,[{owner_user_id:'member',credential_hash:'existing',legacy_auth:0}]);
    assert.deepEqual(result.at(-2)!.rows,[{owner_user_id:null,legacy_auth:0}]);
    assert.deepEqual(result.at(-1)!.rows,[{shared:0}]);
  }finally{await db.prepare(`DROP SCHEMA ${schema} CASCADE`).run();}
});
