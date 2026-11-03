import { test } from "node:test";
import assert from "node:assert/strict";
import { toPg } from "./pg.ts";

test("占位符 ? 依次换成 $1、$2…", () => {
  assert.equal(toPg("SELECT * FROM t WHERE a=? AND b=? LIMIT ?"), "SELECT * FROM t WHERE a=$1 AND b=$2 LIMIT $3");
});

test("字符串字面量里的 ? 不被替换", () => {
  assert.equal(toPg("SELECT '?' AS q, \"a?b\" FROM t WHERE x=?"), "SELECT '?' AS q, \"a?b\" FROM t WHERE x=$1");
});

test("没有占位符时原样返回", () => {
  assert.equal(toPg("SELECT 1"), "SELECT 1");
});
