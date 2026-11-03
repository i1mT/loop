import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTaskStage, targetStage } from "./session-stage.ts";

test("会话状态映射到任务阶段：没有 blocked", () => {
  assert.equal(targetStage("running"), "running");
  assert.equal(targetStage("needs_you"), "needs_you");
  assert.equal(targetStage("crashed"), "needs_you", "崩溃交给人决定");
  assert.equal(targetStage("idle"), "reviewing");
  assert.equal(targetStage("ended"), null);
});

test("合法转换会推进阶段", () => {
  assert.deepEqual(nextTaskStage("queued", "running"), { stage: "running", rejected: false });
  assert.deepEqual(nextTaskStage("running", "needs_you"), { stage: "needs_you", rejected: false });
  assert.deepEqual(nextTaskStage("needs_you", "running"), { stage: "running", rejected: false });
});

test("非法转换被拒绝，阶段保持不变", () => {
  // 已发布不能被会话状态拉回去
  assert.deepEqual(nextTaskStage("published", "running"), { stage: "published", rejected: true });
  // 排队中的任务不能直接变成待审核（必须先 running）
  assert.deepEqual(nextTaskStage("queued", "idle"), { stage: "queued", rejected: true });
});

test("相同阶段不算拒绝", () => {
  assert.deepEqual(nextTaskStage("running", "running"), { stage: "running", rejected: false });
});
