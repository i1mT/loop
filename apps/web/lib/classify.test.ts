import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyScale, scaleAtMost } from "./classify.ts";

const reply = (answers: unknown, status = 200) => (async () => new Response(JSON.stringify({ answers }), { status })) as typeof fetch;

test("规模比较：微小 < 小 < 中 < 大，含等于", () => {
  assert.equal(scaleAtMost("tiny", "small"), true);
  assert.equal(scaleAtMost("small", "small"), true);
  assert.equal(scaleAtMost("medium", "small"), false);
  assert.equal(scaleAtMost("large", "large"), true);
});

test("判定：置信度够就采信，规模与可疑一并返回", async () => {
  const c = await classifyScale("改个文案", { key: "k", fetchImpl: reply({ scale: { choice: "tiny", confidence: 0.9 }, suspicious: { noul: 0.1 } }) });
  assert.deepEqual([c.scale, c.confidence, c.suspicious, c.source], ["tiny", 0.9, false, "model"]);
  const s = await classifyScale("x", { key: "k", fetchImpl: reply({ scale: { choice: "small", confidence: 0.8 }, suspicious: { noul: 0.95 } }) });
  assert.equal(s.suspicious, true);
});

test("降级：低置信度、非法取值、没密钥、接口报错、超时都不抛错且没有规模", async () => {
  assert.equal((await classifyScale("x", { key: "k", fetchImpl: reply({ scale: { choice: "tiny", confidence: 0.3 } }) })).scale, null);
  assert.equal((await classifyScale("x", { key: "k", fetchImpl: reply({ scale: { choice: "huge", confidence: 0.99 } }) })).scale, null);
  const noKey = await classifyScale("x", { key: null });
  assert.deepEqual([noKey.scale, noKey.source], [null, "none"]);
  assert.equal((await classifyScale("x", { key: "k", fetchImpl: reply({}, 500) })).source, "none");
  const slow = (async (_u: unknown, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))))) as typeof fetch;
  const t = await classifyScale("x", { key: "k", fetchImpl: slow, timeoutMs: 20 });
  assert.match(t.reason ?? "", /超时/);
});
