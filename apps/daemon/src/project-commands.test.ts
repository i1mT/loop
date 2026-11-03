import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProjectCommands } from "./project-commands.ts";

test("解析测试、预览两条命令；发布不再是命令约定", () => {
  const md = "# 项目\n\n## 命令\n\n- 测试：`pnpm test`\n- 预览：`pnpm dev`\n- 发布：`./release.sh`\n";
  assert.deepEqual(parseProjectCommands(md), { test: "pnpm test", preview: "pnpm dev" });
});

test("缺失的命令保持 undefined，不猜测", () => {
  assert.deepEqual(parseProjectCommands("- 测试：`npm test`"), { test: "npm test" });
});

test("没有约定格式的行被忽略", () => {
  assert.deepEqual(parseProjectCommands("测试：npm test\n- 预览 `x`"), {});
});
