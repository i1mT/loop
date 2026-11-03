import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrigins, statusToken, sha256Hex } from "./integrations.ts";
import { originAllowed, corsHeaders } from "./origins.ts";
import { signIdentity, verifyIdentity } from "./identity.ts";

test("站点白名单：规范化与格式校验", () => {
  assert.deepEqual(normalizeOrigins("https://a.com/\nhttps://*.b.com, http://localhost:3000"), { value: "https://a.com\nhttps://*.b.com\nhttp://localhost:3000", error: null });
  assert.deepEqual(normalizeOrigins("  "), { value: null, error: null });
  assert.match(normalizeOrigins("a.com")!.error!, /站点格式不对/);
  assert.match(normalizeOrigins("https://a.com/path")!.error!, /站点格式不对/);
});

test("站点校验：精确、通配、不限制；没有 Origin 只在不限制时放行", () => {
  assert.equal(originAllowed("https://a.com", "https://a.com"), true);
  assert.equal(originAllowed("https://x.a.com", "https://*.a.com"), true);
  assert.equal(originAllowed("https://evil.com", "https://*.a.com"), false);
  assert.equal(originAllowed("https://a.com.evil.com", "https://a.com"), false);
  assert.equal(originAllowed("https://anything.com", null), true);
  assert.equal(corsHeaders("https://evil.com", { allowed_origins: "https://a.com" })["Access-Control-Allow-Origin"], undefined);
  assert.equal(corsHeaders("https://a.com", { allowed_origins: "https://a.com" })["Access-Control-Allow-Origin"], "https://a.com");
});

test("身份令牌：签发验证往返；改签名密钥、过期、缺字段都不通过", async () => {
  const t = await signIdentity({ id: "u1", role: "admin", name: "甲", email: "a@b.c" }, "s3cret", 3600);
  const ok = await verifyIdentity(t, "s3cret");
  assert.equal(ok.ok && ok.claims.role, "admin");
  assert.equal((await verifyIdentity(t, "other")).ok, false);
  assert.equal((await verifyIdentity(await signIdentity({ id: "u1", role: "admin" }, "s3cret", -10), "s3cret")).ok, false);
  assert.equal((await verifyIdentity("a.b", "s3cret")).ok, false);
});

test("进度令牌：只对同一任务有效，且随密钥变化", async () => {
  const a = await statusToken("k1", "task-1");
  assert.equal(a, await statusToken("k1", "task-1"));
  assert.notEqual(a, await statusToken("k1", "task-2"));
  assert.notEqual(a, await statusToken("k2", "task-1"));
  assert.equal((await sha256Hex("x")).length, 64);
});
