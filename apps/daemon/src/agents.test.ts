import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorktree } from "./worktree.ts";
import { BUILTIN_SPECS, excludeFromGit } from "./agents.ts";
import { git, makeRepo, tempDir } from "./testing/fixtures.ts";

test("所有内置智能体都以免审批方式启动", () => {
  assert.equal(BUILTIN_SPECS.claude.mode, "bypassPermissions");
  assert.equal(BUILTIN_SPECS.codex.mode, "agent-full-access");
  assert.ok(BUILTIN_SPECS.grok.args.includes("--always-approve"));
  assert.ok(BUILTIN_SPECS.grok.args.indexOf("--always-approve") < BUILTIN_SPECS.grok.args.indexOf("stdio"));
});

test("新增智能体的免审批方式", () => {
  // opencode 的 acp 子命令不认 --auto/--yolo，靠守护进程自动批准
  assert.equal(BUILTIN_SPECS.opencode.autoApprove, true);
  assert.deepEqual(BUILTIN_SPECS.opencode.args, ["acp"]);
  // pi 没有权限系统；dsh 用环境变量关掉沙箱与审批
  assert.equal(BUILTIN_SPECS.pi.autoApprove, undefined);
  assert.match(BUILTIN_SPECS.pi.command, /pi-acp$/);
  assert.equal(BUILTIN_SPECS.dsh.env?.DSH_PERMISSION_MODE, "danger-full-access");
  assert.deepEqual(BUILTIN_SPECS.dsh.args, ["--profile", "acp"]);
  assert.match(BUILTIN_SPECS.dsh.command, /node_modules\/\.bin\/dsh$/);
});

test("excludeFromGit 写入 info/exclude，重复调用不重复追加", async () => {
  const wt = await createWorktree({ repo: makeRepo(), dataDir: tempDir("loopd-ag-"), taskId: "a3", mainRef: "main" });
  await excludeFromGit(wt, ["/x.cfg"]);
  await excludeFromGit(wt, ["/x.cfg"]);
  const common = git(wt.path, "rev-parse", "--git-common-dir").trim();
  const ex = readFileSync(join(common.startsWith("/") ? common : join(wt.path, common), "info", "exclude"), "utf8");
  assert.equal(ex.split("\n").filter((l) => l === "/x.cfg").length, 1);
});
