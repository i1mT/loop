import { test } from "node:test";
import assert from "node:assert/strict";
import { publicOrigin } from "./public-url.ts";
test("通知地址使用部署者配置，拒绝凭证、路径与不安全远程地址", () => {
  assert.equal(
    publicOrigin("https://loop.example.com/"),
    "https://loop.example.com",
  );
  assert.equal(publicOrigin("http://localhost:5190"), "http://localhost:5190");
  for (const url of [
    "http://remote.example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com/?token=x",
    "https://example.com/#x",
  ])
    assert.throws(() => publicOrigin(url));
});
