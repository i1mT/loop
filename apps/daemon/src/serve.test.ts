import { test } from "node:test";
import assert from "node:assert/strict";
import { BUSY_TICK_MS, IDLE_TICK_MS, WAITING_TICK_MS, nextTickMs } from "./serve.ts";

test("没有任何任务：每 60 秒一次", () => {
  assert.equal(nextTickMs([], false), 60_000);
  assert.equal(IDLE_TICK_MS, 60_000);
});

test("会话都空闲（等人审核或评论）：20 秒，且必须小于 60 秒的租约", () => {
  assert.equal(nextTickMs(["idle", "idle"], false), WAITING_TICK_MS);
  assert.ok(WAITING_TICK_MS < 60_000 / 2, "租约 60 秒，续租间隔要留出余量");
});

test("有会话在运行、等权限、启动中或有发布任务：每秒一次", () => {
  assert.equal(nextTickMs(["running"], false), BUSY_TICK_MS);
  assert.equal(nextTickMs(["idle", "needs_you"], false), BUSY_TICK_MS);
  assert.equal(nextTickMs(["starting"], false), BUSY_TICK_MS);
  assert.equal(nextTickMs(["idle"], true), BUSY_TICK_MS, "发布中要快速上报结果");
});

import { buildPrompt } from "./serve.ts";

test("提示词：项目全局指令放在任务之前；没有指令时不出现该段；超长截断", () => {
  const withIns = buildPrompt("改标题", "说明", false, "  这个项目用 pnpm，不要改 legacy/ 目录。 ");
  assert.match(withIns, /## 项目说明/);
  assert.ok(withIns.indexOf("这个项目用 pnpm") < withIns.indexOf("## 任务"), "指令在任务之前");
  assert.doesNotMatch(buildPrompt("改标题", "说明", false, "   "), /## 项目说明/);
  assert.doesNotMatch(buildPrompt("改标题", "说明"), /## 项目说明/);
  assert.ok(buildPrompt("t", "b", false, "x".repeat(20000)).length < 20000);
});
