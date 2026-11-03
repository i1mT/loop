import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentConn } from "./acp/agent-conn.ts";
import { FAKE_SPEC, makeRepo } from "./testing/fixtures.ts";

const open = (env?: Record<string, string>, cwd = makeRepo()) =>
  AgentConn.open({ ...FAKE_SPEC, env }, { cwd, onUpdate: () => {}, onPermission: async () => "cancelled" });

test("能力来自 initialize：load 型智能体", async () => {
  const conn = await open();
  assert.deepEqual(conn.caps, { loadSession: true, resumeSession: false });
  await conn.close();
});

test("只支持 session/resume 的智能体（dsh）：恢复走 resume，且 spec.env 传进了子进程", async () => {
  const cwd = makeRepo();
  const conn = await open({ FAKE_RESUME_ONLY: "1" }, cwd);
  assert.deepEqual(conn.caps, { loadSession: false, resumeSession: true });
  const { sessionId } = await conn.newSession(cwd);
  await conn.restoreSession(sessionId, cwd);
  assert.equal(await conn.prompt(sessionId, "hi"), "end_turn");
  await conn.close();
});

test("load 型智能体恢复时走 session/load 且重放被过滤", async () => {
  const cwd = makeRepo();
  const updates: unknown[] = [];
  const conn = await AgentConn.open(FAKE_SPEC, { cwd, onUpdate: (_s, u) => updates.push(u), onPermission: async () => "cancelled" });
  const { sessionId } = await conn.newSession(cwd);
  await conn.restoreSession(sessionId, cwd);
  assert.equal(updates.length, 0, "历史重放必须被丢弃");
  await conn.close();
});
