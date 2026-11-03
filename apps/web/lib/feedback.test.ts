import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTaskBody } from "./feedback.ts";

const report = { description: "按钮点不了" } as Parameters<typeof composeTaskBody>[0];

test("普通用户或未验证身份提交：正文带“不可信输入”声明", () => {
  assert.match(composeTaskBody(report, []), /不可信输入/);
  assert.match(composeTaskBody(report, [], { trusted: false }), /不可信输入/);
});

test("已验证的管理员提交：视为本人操作，不加不可信声明，描述仍在", () => {
  const body = composeTaskBody(report, [], { trusted: true });
  assert.doesNotMatch(body, /不可信/);
  assert.match(body, /按钮点不了/);
});
