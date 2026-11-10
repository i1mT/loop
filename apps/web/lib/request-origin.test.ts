import { test } from "node:test";
import assert from "node:assert/strict";

// 登录后的会话校验依赖 origin 与登录时一致。服务端组件拿不到请求 URL，只能看 Host 与
// 反代头；若按主机名猜协议，公网 IP 走 HTTP 的部署会被猜成 https，会话一律判为无效，
// 表现就是「登录成功后又被弹回登录页」。这里固定住推导规则。

const load = async () => {
  process.env.LOOP_PUBLIC_URL = "http://118.196.30.108:3220";
  return (await import("./public-url.ts")).requestOrigin;
};

// 直接用真实 Headers：requestOrigin 只依赖 get()，但用真类型能避免替身与生产行为漂移。
const headers = (map: Record<string, string>) => new Headers(map);

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

test("publicOrigin：IP 直连允许 HTTP，域名仍要求 HTTPS", async () => {
  const { publicOrigin } = await import("./public-url.ts");
  // IP + 端口直连没有证书，强制 HTTPS 会让后台通知整体不可用。
  assert.equal(publicOrigin("http://118.196.30.108:3220"), "http://118.196.30.108:3220");
  assert.equal(publicOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(publicOrigin("http://192.168.1.10"), "http://192.168.1.10");
  assert.equal(publicOrigin("https://loop.example.com"), "https://loop.example.com");
  // 域名走 HTTP 仍拒绝：对公网暴露的会话必须加密。
  assert.throws(() => publicOrigin("http://loop.example.com"), /HTTPS/);
  // 结构性错误一律拒绝，避免把通知发到异常地址。
  assert.throws(() => publicOrigin("https://u:p@loop.example.com"), /HTTPS/);
  assert.throws(() => publicOrigin("https://loop.example.com/path"), /HTTPS/);
  assert.throws(() => publicOrigin("https://loop.example.com?a=1"), /HTTPS/);
});
