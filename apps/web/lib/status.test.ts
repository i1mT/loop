import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGE_INFO, pipelinePosition, stageInfo, GROUP_ORDER, canRetryPublish } from "./status.ts";

test("每个阶段都有文案与分组", () => {
  for (const [stage, info] of Object.entries(STAGE_INFO)) {
    assert.ok(info.label, stage);
    assert.ok(GROUP_ORDER.includes(info.group), stage);
  }
});

test("未知阶段降级显示原文，不抛错", () => {
  assert.equal(stageInfo("whatever").label, "whatever");
});

test("流水线位置：开发中、待审核、发布、完成、终止", () => {
  assert.deepEqual(pipelinePosition("running"), { index: 1, closed: false });
  assert.deepEqual(pipelinePosition("reviewing"), { index: 2, closed: false });
  assert.deepEqual(pipelinePosition("publishing"), { index: 3, closed: false });
  assert.deepEqual(pipelinePosition("published"), { index: 4, closed: false });
  assert.equal(pipelinePosition("failed").closed, true);
});

test("发布失败但有 PR 和批准提交：重试发布，不重建 PR", () => {
  assert.equal(canRetryPublish("failed", true, true, false), true);
  assert.equal(canRetryPublish("publish_review", true, true, false), true);
  assert.equal(canRetryPublish("reviewing", false, false, true), true);
  assert.equal(canRetryPublish("failed", false, false, true), true);
  assert.equal(canRetryPublish("failed", false, true, false), false);
  assert.equal(canRetryPublish("failed", true, false, false), false);
  assert.equal(canRetryPublish("running", true, true, true), false);
});
