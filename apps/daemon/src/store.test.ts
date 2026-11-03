import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { SessionStore } from "./store.ts";
import { tempDir } from "./testing/fixtures.ts";

const meta = { id: "s1", taskId: "t1", agent: "claude", cwd: "/x", repo: "/r", mainRef: "main", branch: "loop/t1", base: "abc" };

test("序号单调递增，且重启后从已存的最大序号续接", () => {
  const dir = tempDir("loopd-store-");
  const a = new SessionStore(dir);
  a.createSession(meta);
  a.append("s1", { kind: "message", payload: { role: "agent", text: "一" } });
  a.append("s1", { kind: "message", payload: { role: "agent", text: "二" } });
  const b = new SessionStore(dir); // 模拟重启
  const e = b.append("s1", { kind: "message", payload: { role: "agent", text: "三" } });
  assert.equal(e.seq, 2);
  assert.deepEqual(
    b.read("s1").map((x) => x.seq),
    [0, 1, 2],
  );
});

test("崩溃留下的半截行被忽略，不影响已有事件", () => {
  const dir = tempDir("loopd-store-");
  const s = new SessionStore(dir);
  s.createSession(meta);
  s.append("s1", { kind: "message", payload: { role: "agent", text: "完整" } });
  appendFileSync(join(dir, "sessions", "s1.events.jsonl"), '{"seq":1,"sessionId":"s1","kind":"mess');
  assert.equal(new SessionStore(dir).read("s1").length, 1);
});

test("非法事件拒绝写入", () => {
  const dir = tempDir("loopd-store-");
  const s = new SessionStore(dir);
  s.createSession(meta);
  assert.throws(() => s.append("s1", { kind: "status", payload: { state: "blocked" } }), /非法事件/);
  assert.equal(s.read("s1").length, 0);
});

test("元数据原子更新并可列出", () => {
  const dir = tempDir("loopd-store-");
  const s = new SessionStore(dir);
  s.createSession(meta);
  s.updateMeta("s1", { state: "needs_you" });
  assert.equal(s.getMeta("s1")?.state, "needs_you");
  assert.equal(s.listMetas().length, 1);
});
