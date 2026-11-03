import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSessionEvent, NeedsYouRequest } from "./session-events.js";
import { STAGES, canTransition, canReopen, nextStages, TERMINAL, type Stage } from "./task-states.js";
import { mapAcpUpdate } from "./acp-mapping.js";
import { validateAgentPatch } from "./task-attributes.js";

const base = { seq: 0, sessionId: "s1", at: 1 };

test("统一事件：合法事件通过，非法事件给出路径级错误", () => {
  assert.equal(parseSessionEvent({ ...base, kind: "message", payload: { role: "agent", text: "pong" } }).ok, true);
  const bad = parseSessionEvent({ ...base, kind: "message", payload: { role: "robot", text: "x" } });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /payload\.role/);
  assert.equal(parseSessionEvent({ sessionId: "s1", at: 1, kind: "stop", payload: { stopReason: "end_turn" } }).ok, false, "缺 seq 必须拒绝");
  assert.equal(parseSessionEvent({ ...base, kind: "blocked", payload: {} }).ok, false, "没有 blocked 事件");
});

test("统一事件：会话状态包含 needs_you 与 crashed", () => {
  assert.equal(parseSessionEvent({ ...base, kind: "status", payload: { state: "needs_you" } }).ok, true);
  assert.equal(parseSessionEvent({ ...base, kind: "status", payload: { state: "crashed" } }).ok, true);
  assert.equal(parseSessionEvent({ ...base, kind: "status", payload: { state: "blocked" } }).ok, false, "没有 blocked 状态");
});

test("统一事件：权限请求至少一个选项，人工介入选项 1–6 个", () => {
  const perm = parseSessionEvent({ ...base, kind: "permission_request", payload: { requestId: "r", title: "Fetch", options: [] } });
  assert.equal(perm.ok, false);
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, label: `选项${i}` }));
  assert.equal(NeedsYouRequest.safeParse({ reason: "rule:main-moved", question: "q", options: many }).success, false);
  assert.equal(NeedsYouRequest.safeParse({ reason: "agent", question: "q", options: [{ id: "a", label: "是" }] }).success, true);
});

test("状态机：没有 blocked，且终态无出边", () => {
  assert.ok(!(STAGES as readonly string[]).includes("blocked"));
  for (const s of TERMINAL) assert.equal(nextStages(s).length, 0, `${s} 不应有出边`);
});

test("状态机：所有阶段都能从 received 到达（无孤立阶段）", () => {
  const seen = new Set<Stage>(["received"]);
  const queue: Stage[] = ["received"];
  while (queue.length) for (const n of nextStages(queue.shift()!)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  assert.deepEqual([...STAGES].filter((s) => !seen.has(s)), [], "存在不可达阶段");
});

test("状态机：需要人介入可回到 running，但不能直接发布", () => {
  assert.equal(canTransition("running", "needs_you"), true);
  assert.equal(canTransition("needs_you", "running"), true);
  assert.equal(canTransition("running", "published"), false, "必须经过审核与发布");
  assert.equal(canTransition("reviewing", "approved"), true);
  assert.equal(canTransition("approved", "published"), false, "必须经过 publishing");
});

test("状态机：终态只能人工重开，且只能重开到终态的允许集合", () => {
  assert.equal(canReopen("published"), false, "已发布不可重开");
  assert.equal(canReopen("rejected"), true);
  assert.equal(canReopen("failed"), true);
  assert.equal(canReopen("cancelled"), true);
  assert.equal(canReopen("running"), false);
});

// 夹具来自阶段 01 实测抓取的真实 ACP 更新（见 docs/contracts/acp-findings.md）
test("ACP 映射：文本块、思考块", () => {
  assert.deepEqual(mapAcpUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "pong" } }), { kind: "message", payload: { role: "agent", text: "pong" } });
  assert.deepEqual(mapAcpUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } }), { kind: "thought", payload: { text: "hmm" } });
});

test("ACP 映射：工具调用（claude 的 Read 与 codex 的 exec_command 形态）", () => {
  const claude = mapAcpUpdate({ sessionUpdate: "tool_call", toolCallId: "toolu_01", title: "Read a.txt", kind: "read", status: "pending", rawInput: {} });
  assert.equal(claude?.kind, "tool");
  assert.equal((claude as any).payload.status, "pending");
  const codex = mapAcpUpdate({ sessionUpdate: "tool_call_update", toolCallId: "call-1-0", title: "cat a.txt", name: "exec_command", kind: "execute", status: "in_progress" });
  assert.equal((codex as any).payload.toolKind, "execute");
  assert.equal((codex as any).payload.status, "in_progress");
});

test("ACP 映射：用量保留费用，缺费用时为 undefined（opencode/codex 有时无费用）", () => {
  const withCost = mapAcpUpdate({ sessionUpdate: "usage_update", used: 24856, size: 1000000, cost: { amount: 0.065, currency: "USD" } });
  assert.deepEqual(withCost, { kind: "usage", payload: { used: 24856, size: 1000000, costUsd: 0.065 } });
  const noCost = mapAcpUpdate({ sessionUpdate: "usage_update", used: 18595, size: 950000 }) as any;
  assert.equal(noCost.payload.costUsd, undefined);
});

test("ACP 映射：tool_call_update 缺少 title/kind 时不臆造", () => {
  const upd = mapAcpUpdate({ sessionUpdate: "tool_call_update", toolCallId: "t9", status: "completed" }) as any;
  assert.equal(upd.payload.title, undefined);
  assert.equal(upd.payload.toolKind, undefined);
  assert.equal(upd.payload.status, "completed");
});

test("ACP 映射：未知或残缺更新返回 null，不抛出", () => {
  assert.equal(mapAcpUpdate({ sessionUpdate: "available_commands_update", availableCommands: [] }), null);
  assert.equal(mapAcpUpdate({ sessionUpdate: "tool_call", title: "no id" }), null, "无 toolCallId 必须丢弃");
  assert.equal(mapAcpUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "image" } }), null);
});

test("属性只读：智能体补丁含属性键整体拒绝，网关可写", () => {
  const agent = { actor: "agent" as const, taskId: "t1" };
  const gw = { actor: "gateway" as const, taskId: "t1" };
  const r = validateAgentPatch(agent, { releaseReview: false, title: "x" });
  assert.deepEqual(r, { ok: false, rejected: ["releaseReview"] });
  assert.deepEqual(validateAgentPatch(agent, { notes: "ok" }), { ok: true });
  assert.deepEqual(validateAgentPatch(gw, { releaseReview: false }), { ok: true });
});

test("状态机：发布前提交变了（rebase）必须回到待审核，不能直接发布", () => {
  assert.equal(canTransition("publishing", "reviewing"), true);
  assert.equal(canTransition("publishing", "published"), true, "智能体明确发布成功可直接到 published");
  assert.equal(canTransition("publishing", "publish_review"), true);
  assert.equal(canTransition("publish_review", "published"), true);
  assert.equal(canTransition("publish_review", "failed"), true);
  assert.equal(canTransition("approved", "reviewing"), false, "审核通过后不能直接回退，只能在发布时发现");
});

test("统一事件：检查结果是独立的事件，不是状态", () => {
  assert.equal(parseSessionEvent({ ...base, kind: "check", payload: { name: "test", ok: true, output: "ok" } }).ok, true);
  assert.equal(parseSessionEvent({ ...base, kind: "check", payload: { name: "lint", ok: true, output: "" } }).ok, false, "未知检查名必须拒绝");
});
