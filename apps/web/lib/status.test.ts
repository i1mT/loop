import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGE_INFO, pipelinePosition, stageInfo, GROUP_ORDER, canRetryPublish, isTaskExecuting, listedTaskStageInfo } from "./status.ts";

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

test("列表区分正在执行、等待机器和需要人工处理", () => {
  const task = { stage: "running", error: null, lease_active: true, plan_phase: "analyzing" };
  assert.equal(listedTaskStageInfo(task).label, "正在分析方案");
  assert.equal(isTaskExecuting(task), true);
  assert.equal(listedTaskStageInfo({ ...task, plan_phase: "implementing" }).label, "正在实现");
  const waiting = { ...task, lease_active: false };
  assert.equal(listedTaskStageInfo(waiting).label, "等待机器接手");
  assert.equal(isTaskExecuting(waiting), false);
  assert.equal(isTaskExecuting({ ...task, stage: "production_review" }), false);
  assert.equal(isTaskExecuting({ ...task, stage: "preview_test", error: "部署未完成" }), false);
  const deploying = { stage: "preview_deploy", error: null, lease_active: false, deployment_pending: true };
  assert.equal(isTaskExecuting(deploying), true);
  assert.equal(listedTaskStageInfo(deploying).tone, "live");
  assert.equal(isTaskExecuting({ ...deploying, error: "流水线已失败" }), false);
  assert.equal(isTaskExecuting({ ...deploying, deployment_pending: false }), false);
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
