import { test } from "node:test";
import assert from "node:assert/strict";
import { signLocalSession, verifyLocalSession } from "./local-session.ts";
import { clearFailures, recordFailure, tooManyFailures } from "./login-throttle.ts";

test("本地会话 cookie：签名往返；篡改、换密钥、空值都不通过", async () => {
  const v = await signLocalSession("secret-a", "me@example.com");
  assert.equal(await verifyLocalSession("secret-a", v), "me@example.com");
  assert.equal(await verifyLocalSession("secret-b", v), null);
  const [p, s] = v.split(".");
  assert.equal(await verifyLocalSession("secret-a", `${btoa("evil@example.com")}.${s}`), null);
  assert.equal(await verifyLocalSession("secret-a", `${p}.`), null);
  assert.equal(await verifyLocalSession("secret-a", null), null);
});

test("登录失败节流：1 分钟内第 9 次起拒绝，窗口过后恢复，成功后清零", () => {
  const k = "1.2.3.4|a@b.c";
  const t0 = 1_000_000;
  for (let i = 0; i < 8; i++) { assert.equal(tooManyFailures(k, t0 + i), false); recordFailure(k, t0 + i); }
  assert.equal(tooManyFailures(k, t0 + 10), true);
  assert.equal(tooManyFailures(k, t0 + 61_000), false);
  recordFailure(k, t0 + 61_000);
  clearFailures(k);
  assert.equal(tooManyFailures(k, t0 + 61_001), false);
});
