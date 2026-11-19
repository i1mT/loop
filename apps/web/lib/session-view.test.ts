import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, type Ev } from "./session-fold.ts";
import { taskProgress } from "./status.ts";

test("发布展示区分等待、合并、正在发布、超时待确认和明确失败", () => {
  const task = { stage: "publishing" as const, error: null, merge_sha: "abc1234", merged_at: 2 };
  const session = { state: "running", updated_at: 3 };
  assert.equal(taskProgress(task, session, false).activity?.spinning, false);
  assert.equal(taskProgress({ ...task, merge_sha: null }, null, true).info.label, "正在同步并合并 PR");
  assert.equal(taskProgress(task, { ...session, updated_at: 1 }, true).info.label, "正在准备发布");
  assert.equal(taskProgress(task, session, true).activity?.label, "智能体正在发布");
  for (const [error, label] of [["等待会话 test-123 状态超时（当前 running）", "待确认发布"], ["部署脚本退出失败", "发布失败"]]) {
    const progress = taskProgress({ ...task, stage: "failed", error }, session, true);
    assert.equal(progress.info.label, label);
    assert.equal(progress.activity, null);
    assert.deepEqual(progress.step, { index: 3, closed: false });
  }
});

const ev = (seq: number, kind: string, payload: Record<string, unknown>): Ev => ({ seq, kind, at: seq, payload });

test("连续的文本块合并为一条消息", () => {
  const { items } = fold([ev(0, "message", { role: "agent", text: "你" }), ev(1, "message", { role: "agent", text: "好" }), ev(2, "message", { role: "user", text: "嗯" })]);
  assert.equal(items.length, 2);
  assert.equal((items[0] as { text: string }).text, "你好");
});

test("同一个工具调用的多次更新合并，保留最终状态与名称", () => {
  const { items } = fold([
    ev(0, "tool", { toolCallId: "t1", title: "编辑 a.txt", toolKind: "edit", status: "pending" }),
    ev(1, "tool", { toolCallId: "t1", status: "completed" }),
  ]);
  assert.equal(items.length, 1);
  const t = items[0] as { status: string; title: string; toolKind: string };
  assert.equal(t.status, "completed");
  assert.equal(t.title, "编辑 a.txt");
  assert.equal(t.toolKind, "edit");
});

test("同一路径的 diff 只保留最新一份", () => {
  const { items } = fold([ev(0, "diff", { path: "a.txt", change: "modified", patch: "old" }), ev(1, "diff", { path: "a.txt", change: "modified", patch: "new" })]);
  assert.equal(items.length, 1);
  assert.equal((items[0] as { patch: string }).patch, "new");
});

test("needs_you 在对应的权限请求被决定后显示为已回答", () => {
  const open = fold([
    ev(0, "permission_request", { requestId: "r1", title: "x", options: [{ optionId: "allow", name: "允许", kind: "allow_once" }] }),
    ev(1, "needs_you", { reason: "rule:permission", question: "允许吗？", options: [{ id: "allow", label: "允许" }] }),
  ]);
  assert.equal((open.items[0] as { answered: boolean }).answered, false);
  const done = fold([
    ev(0, "permission_request", { requestId: "r1", title: "x", options: [] }),
    ev(1, "needs_you", { reason: "rule:permission", question: "允许吗？", options: [{ id: "allow", label: "允许" }] }),
    ev(2, "permission_resolved", { requestId: "r1", optionId: "allow", decidedBy: "human" }),
  ]);
  assert.equal((done.items[0] as { answered: boolean }).answered, true);
});

test("用量只保留最新一条，不进入时间线", () => {
  const { items, lastUsage } = fold([ev(0, "usage", { used: 10 }), ev(1, "usage", { used: 20, costUsd: 0.01 })]);
  assert.equal(items.length, 0);
  assert.equal((lastUsage as { used: number }).used, 20);
});

test("连续相同的状态只保留一条；不同状态或带说明的保留", () => {
  const { items } = fold([ev(0, "status", { state: "running" }), ev(1, "status", { state: "running" }), ev(2, "status", { state: "needs_you" }), ev(3, "status", { state: "running", detail: "已自动同步" })]);
  assert.deepEqual(items.map((i) => (i as { state: string }).state), ["running", "needs_you", "running"]);
});

test("检查结果进入时间线，但不影响阶段相关的状态", () => {
  const { items } = fold([ev(0, "check", { name: "test", ok: true, output: "ok" }), ev(1, "status", { state: "idle" })]);
  assert.equal(items[0].type, "check");
  assert.equal(items[1].type, "status");
});
