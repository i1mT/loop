import { test } from "node:test";
import assert from "node:assert/strict";

// 登录后的会话校验依赖 origin 与登录时一致。服务端组件拿不到请求 URL，只能看 Host 与
// 反代头；若按主机名猜协议，公网 IP 走 HTTP 的部署会被猜成 https，会话一律判为无效，
// 表现就是「登录成功后又被弹回登录页」。这里固定住推导规则。

const load = async () => {
  process.env.LOOP_PUBLIC_URL = "http://118.196.30.108:3220";
  return (await import("./public-url.ts")).requestOrigin;
};

const headers = (map: Record<string, string>) => ({
  get: (key: string) => map[key.toLowerCase()] ?? null,
});

test("反代给出的协议优先于对外地址配置", async () => {
  const requestOrigin = await load();
  assert.equal(requestOrigin(headers({ "x-forwarded-proto": "https", host: "loop.example.com" }), "loop.example.com"), "https://loop.example.com");
  assert.equal(requestOrigin(headers({ "x-forwarded-proto": "http", host: "loop.example.com" }), "loop.example.com"), "http://loop.example.com");
});

test("没有反代时跟随 LOOP_PUBLIC_URL 的协议，不按主机名猜", async () => {
  const requestOrigin = await load();
  // 关键回归点：公网 IP + HTTP 直接暴露，旧实现会错误地得到 https。
  assert.equal(requestOrigin(headers({ host: "118.196.30.108:3220" }), "118.196.30.108:3220"), "http://118.196.30.108:3220");
});

test("多值与畸形头部不会把协议判错", async () => {
  const requestOrigin = await load();
  // 反代链路上 X-Forwarded-Proto 可能是 "https, http"，取第一个。
  assert.equal(requestOrigin(headers({ "x-forwarded-proto": "https, http", host: "a.test" }), "a.test"), "https://a.test");
  // 无法识别的值退回对外地址配置，而不是原样拼进 origin。
  assert.equal(requestOrigin(headers({ "x-forwarded-proto": "ftp", host: "a.test" }), "a.test"), "http://a.test");
});

test("保留端口，不吞掉 host 里的冒号", async () => {
  const requestOrigin = await load();
  assert.equal(requestOrigin(headers({ host: "127.0.0.1:3000" }), "127.0.0.1:3000"), "http://127.0.0.1:3000");
});
