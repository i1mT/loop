import { test } from "node:test";
import assert from "node:assert/strict";
import { blocksImplementation, validatePlan } from "./task-plan/contract.ts";
test("实现必须等待方案保存或审核完成", () => {
  for (const phase of ["analyzing", "syncing", "awaiting_review"] as const)
    assert.equal(blocksImplementation(phase), true);
  assert.equal(blocksImplementation("implementing"), false);
  assert.equal(blocksImplementation(undefined), false);
});
test("方案产物包含必要技术章节", () => {
  const body = ["背景", "目标", "技术实现", "改动点", "验证方式", "风险与回滚"]
    .map((x) => `## ${x}\n完整的需求、实现和验证记录。`)
    .join("\n");
  assert.equal(validatePlan(body), null);
  assert.match(validatePlan(body.replace("## 技术实现", "实现"))!, /技术实现/);
});
