import { test } from "node:test";
import assert from "node:assert/strict";
import { isDaemonPath, shouldForward, upstreamHeaders, upstreamUrl } from "./upstream.ts";

test("哪些路径转发到云端", () => {
  assert.equal(shouldForward("/api/tasks"), true);
  assert.equal(shouldForward("/api/tasks/abc/session"), true);
  assert.equal(shouldForward("/api/projects"), true);
  assert.equal(shouldForward("/api/machines"), true);
  assert.equal(shouldForward("/api/login"), false);
  assert.equal(shouldForward("/api/logout"), false);
  assert.equal(shouldForward("/api/status"), false);
  assert.equal(shouldForward("/tasks/abc"), false);
  assert.equal(isDaemonPath("/api/daemon/claim"), true);
  assert.equal(isDaemonPath("/api/tasks"), false);
});

test("转发地址保留路径与查询，基础地址的尾部斜杠不重复", () => {
  assert.equal(upstreamUrl("https://x.example/", "/api/tasks/1/session", "?after=3"), "https://x.example/api/tasks/1/session?after=3");
  assert.equal(upstreamUrl("https://x.example", "/api/tasks", ""), "https://x.example/api/tasks");
});

test("转发头：换成云端令牌，不带浏览器 cookie 与本机令牌", () => {
  const h = upstreamHeaders(new Headers({ cookie: "loop_session=secret", authorization: "Bearer local-token", "content-type": "application/json", host: "localhost:5191", "x-forwarded-for": "1.2.3.4" }), "CLOUD");
  assert.equal(h.get("authorization"), "Bearer CLOUD");
  assert.equal(h.get("content-type"), "application/json");
  assert.equal(h.get("cookie"), null);
  assert.equal(h.get("host"), null);
  assert.equal(h.get("x-forwarded-for"), null);
  assert.equal(h.get("x-loop-space"), null);
});

test("转发头保留当前空间与登录邮箱", () => {
  const h = upstreamHeaders(new Headers({ "x-loop-space": "space_default", "x-loop-user": "a@x.com" }), "CLOUD");
  assert.equal(h.get("x-loop-space"), "space_default");
  assert.equal(h.get("x-loop-user"), "a@x.com");
  assert.equal(h.get("authorization"), "Bearer CLOUD");
});
