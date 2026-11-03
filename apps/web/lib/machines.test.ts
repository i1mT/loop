import { test } from "node:test";
import assert from "node:assert/strict";
import { ONLINE_MS, isOnline, validMachineId } from "./machines.ts";

test("在线判定：3 分钟内联系过算在线", () => {
  assert.equal(isOnline(1000, 1000 + ONLINE_MS), true);
  assert.equal(isOnline(1000, 1000 + ONLINE_MS + 1), false);
});

test("机器 ID 合法性", () => {
  for (const ok of ["mac-home", "office.pc", "a", "m1_x"]) assert.equal(validMachineId(ok), true, ok);
  for (const bad of ["", "Mac", "-x", "a b", "x".repeat(65), 5 as unknown, null as unknown]) assert.equal(validMachineId(bad), false, String(bad));
});
