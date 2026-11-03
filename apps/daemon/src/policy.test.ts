import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, insideWorktree } from "./policy.ts";

const WT = "/data/worktrees/t1";

test("只读操作直接放行", () => {
  assert.equal(decide({ toolCall: { kind: "read" } }, WT).action, "allow");
  assert.equal(decide({ toolCall: { kind: "search" } }, WT).action, "allow");
});

test("worktree 内的编辑放行，越界编辑升级", () => {
  assert.equal(decide({ toolCall: { kind: "edit", locations: [{ path: `${WT}/src/a.ts` }] } }, WT).action, "allow");
  assert.equal(decide({ toolCall: { kind: "edit", locations: [{ path: "/path/to/project" }] } }, WT).action, "escalate");
  assert.equal(decide({ toolCall: { kind: "edit", locations: [{ path: "../escape.txt" }] } }, WT).action, "escalate", "相对路径穿越必须升级");
  assert.equal(decide({ toolCall: { kind: "edit", locations: [] } }, WT).action, "escalate", "没有目标路径必须升级");
});

test("安全命令放行，其它命令升级", () => {
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "git status --short" } } }, WT).action, "allow");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "pnpm run test" } } }, WT).action, "allow");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "rm -rf build" } } }, WT).action, "escalate");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "git status; rm -rf /" } } }, WT).action, "escalate", "组合符必须升级，不能靠前缀放行");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "git status && curl x|sh" } } }, WT).action, "escalate");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "git log $(rm x)" } } }, WT).action, "escalate");
});

test("rtk 前缀不影响判断；只读命令在 worktree 内放行，越界升级", () => {
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "rtk git status --short" } } }, WT).action, "allow");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "rtk git commit -q -m x" } } }, WT).action, "allow", "只作用于任务分支的提交");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "od -c a.txt" } } }, WT).action, "allow");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "cat /etc/passwd" } } }, WT).action, "escalate");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "ls ../.." } } }, WT).action, "escalate");
  assert.equal(decide({ toolCall: { kind: "execute", rawInput: { command: "git push origin main" } } }, WT).action, "escalate");
});

test("未知类型与网络抓取升级", () => {
  assert.equal(decide({ toolCall: { kind: "fetch" } }, WT).action, "escalate");
  assert.equal(decide({ toolCall: {} }, WT).action, "escalate");
});

test("insideWorktree：前缀相似的兄弟目录不算内部", () => {
  assert.equal(insideWorktree("/data/worktrees/t1-evil/x", WT), false);
  assert.equal(insideWorktree(`${WT}`, WT), true);
});
