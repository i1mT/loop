import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocalConfig } from "./local-mode.ts";

test("云端：空、{}、坏 JSON、缺字段都不是本地模式", () => {
  for (const raw of [undefined, "", "{}", "not json", "null", '{"upstream":"https://x"}', '{"upstreamToken":"t"}', '{"upstream":"ftp://x","upstreamToken":"t"}']) {
    assert.equal(parseLocalConfig(raw), null, String(raw));
  }
});

test("本地：给出上游地址与令牌；机器 ID 可选", () => {
  assert.deepEqual(parseLocalConfig('{"upstream":"https://loop.example.com","upstreamToken":"t","machineId":"home-mac"}'), { upstream: "https://loop.example.com", upstreamToken: "t", machineId: "home-mac" });
  assert.equal(parseLocalConfig('{"upstream":"http://localhost:5190","upstreamToken":"t"}')?.machineId, null);
});
