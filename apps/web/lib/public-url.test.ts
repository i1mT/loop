import { test } from "node:test";
import assert from "node:assert/strict";
import { publicOrigin } from "./public-url.ts";

// 协议与路径都不由这里限制：自建部署常先用 HTTP + IP，也可能挂在子路径下。
// 这里只拦真正有害的形态——带凭证会把密码发进通知链接，查询串与锚点则不是网关根地址。
test("通知地址使用部署者配置，只拒绝凭证、查询串与锚点", () => {
  assert.equal(publicOrigin("https://loop.example.com/"), "https://loop.example.com");
  assert.equal(publicOrigin("http://localhost:5190"), "http://localhost:5190");
  assert.equal(publicOrigin("http://remote.example.com"), "http://remote.example.com");
  assert.equal(publicOrigin("https://example.com/path"), "https://example.com");
  for (const url of [
    "https://user:pass@example.com",
    "https://example.com/?token=x",
    "https://example.com/#x",
    "ftp://example.com",
  ])
    assert.throws(() => publicOrigin(url));
});
