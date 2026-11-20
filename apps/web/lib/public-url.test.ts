import { test } from "node:test";
import assert from "node:assert/strict";
import { configuredPublicOrigin, publicOrigin, requestOrigin, upstreamPublicOrigin } from "./public-url.ts";

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

test("从 IP 访问和本机转发都使用网关公开地址", async (t) => {
  const saved = process.env.LOOP_PUBLIC_URL;
  t.after(() => {
    if (saved === undefined) delete process.env.LOOP_PUBLIC_URL;
    else process.env.LOOP_PUBLIC_URL = saved;
  });
  process.env.LOOP_PUBLIC_URL = "https://loop.example.com/";
  const local = { upstream: "http://192.0.2.1:3000/", upstreamToken: "fixture" };
  const browserOrigin = requestOrigin(new Headers({ "x-forwarded-proto": "http" }), "192.0.2.1:3000");
  assert.equal(browserOrigin, "http://192.0.2.1:3000");
  assert.equal(configuredPublicOrigin() ?? browserOrigin, "https://loop.example.com");

  const fetchStatus = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "http://192.0.2.1:3000/api/status");
    assert.equal(new Headers(options.headers).get("authorization"), "Bearer fixture");
    return Response.json({ mode: "cloud", base: "https://loop.example.com/" });
  });
  assert.equal(await upstreamPublicOrigin(local), "https://loop.example.com");
  assert.equal(fetchStatus.mock.callCount(), 1);
  fetchStatus.mock.mockImplementation(async () => new Response(null, { status: 502 }));
  assert.equal(await upstreamPublicOrigin(local), "http://192.0.2.1:3000");
});
