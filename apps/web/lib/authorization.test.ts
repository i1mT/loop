import { test } from "node:test";
import assert from "node:assert/strict";
import { isSuperAdmin } from "./spaces.ts";
import type { Db } from "./pg.ts";
function database(role: string | null, email = "admin@example.com") {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => (role === null ? null : { role, email }),
      }),
    }),
  } as unknown as Db;
}
test("超级管理员只由数据库角色决定，不依赖姓名或固定邮箱", async () => {
  assert.equal(
    await isSuperAdmin(database("super", "owner@example.org"), "user"),
    true,
  );
  assert.equal(await isSuperAdmin(database("member"), "user"), false);
  assert.equal(await isSuperAdmin(database(null), "missing"), false);
});
