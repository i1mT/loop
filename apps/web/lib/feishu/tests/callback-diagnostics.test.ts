import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { withCallbackDiagnostics } from "../callback-diagnostics.ts";
import { seal } from "../crypto.ts";

// 仅替换入口的外部依赖，保留真实验签、解密和诊断代码；不连接数据库或公网。
const routeUrl = new URL("../../../app/api/feishu/webhook/[id]/route.ts", import.meta.url).href;
const state = {
  binding: null as Record<string, unknown> | null,
  databaseError: false,
  writes: 0,
  enqueued: 0,
};
const key = Buffer.alloc(32, 7).toString("base64");
const db = {
  prepare: () => ({ bind: () => ({ run: async () => { state.writes++; } }) }),
};
const modules: Record<string, object> = {
  "@/lib/db.ts": { getDb: async () => {
    if (state.databaseError) throw new Error("private-database-url");
    return db;
  } },
  "@/lib/env.ts": { getEnv: () => ({ FEISHU_ENCRYPTION_KEY: key }) },
  "@/lib/feishu/bindings.ts": { getBindingById: async () => state.binding },
  "@/lib/feishu/events.ts": { pinEventTenant: async () => true },
  "@/lib/feishu/jobs/store.ts": { enqueue: async () => { state.enqueued++; } },
  "@/lib/http.ts": {
    json: (value: unknown) => Response.json(value),
    fail: (status: number, error: string) => Response.json({ ok: false, error }, { status }),
  },
};
const mockUrls = new Map<string, string>();
for (const [name, exports] of Object.entries(modules)) {
  const url = `loop-callback-test:${name}`;
  mockUrls.set(name, url);
  // 同步 hook 通过全局注册表向合成模块提供当前测试的依赖。
  (globalThis as Record<string, unknown>)[url] = exports;
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && decodeURI(context.parentURL) === decodeURI(routeUrl)) {
      const mock = mockUrls.get(specifier);
      if (mock) return { url: mock, shortCircuit: true };
      if (specifier.startsWith("@/"))
        return { url: new URL(`../../../${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("loop-callback-test:")) {
      const name = url.slice("loop-callback-test:".length);
      return {
        format: "module", shortCircuit: true,
        source: Object.keys(modules[name]).map((key) =>
          `export const ${key} = globalThis[${JSON.stringify(url)}][${JSON.stringify(key)}];`,
        ).join("\n"),
      };
    }
    return nextLoad(url, context);
  },
});
const { POST } = await import(routeUrl);

test("回调真实入口记录到达、状态和耗时，日志不含凭证或正文", async () => {
  const logs: string[] = [];
  const original = console.info;
  console.info = (line: string) => { logs.push(line); };
  const request = (body: string, headers?: Record<string, string>) => POST(
    new Request("https://example.com/api/feishu/webhook/private-binding", { method: "POST", body, headers }),
    { params: Promise.resolve({ id: "private-binding" }) },
  );
  const check = (status: number, stage: string) => {
    const received = JSON.parse(logs.at(-2)!);
    const completed = JSON.parse(logs.at(-1)!);
    assert.equal(received.event, "feishu_callback_received");
    assert.equal(completed.event, "feishu_callback_completed");
    assert.equal(completed.requestId, received.requestId);
    assert.equal(completed.status, status);
    assert.equal(completed.stage, stage);
    assert.ok(completed.durationMs >= 0);
    assert.deepEqual(Object.keys(completed).sort(), ["durationMs", "event", "requestId", "stage", "status"]);
  };
  try {
    assert.equal((await request("{}")).status, 404);
    check(404, "binding");
    state.binding = {
      app_id: "cli_private", enabled: 1,
      secrets: await seal({ encryptKey: "private-encrypt", verificationToken: "private-token", appSecret: "private-secret" }, key, "private-binding"),
    };
    assert.equal((await request("{}", { "content-length": "100001" })).status, 413);
    check(413, "body");
    assert.equal((await request("x".repeat(100001))).status, 413);
    check(413, "body");
    for (const body of ["{", JSON.stringify({ type: "url_verification", token: "wrong", challenge: "private-challenge" })]) {
      assert.equal((await request(body)).status, 403);
      check(403, "decode");
    }
    const body = JSON.stringify({ type: "url_verification", token: "private-token", challenge: "private-challenge" });
    const response = await request(body);
    assert.deepEqual(await response.json(), { challenge: "private-challenge" });
    check(200, "challenge");
    assert.equal(state.writes, 1);
    assert.equal(state.enqueued, 0);
    assert.equal((await request(body, { "x-lark-signature": "private-signature" })).status, 403);
    check(403, "decode");
    state.binding.secrets = "invalid-private-secret";
    assert.equal((await request(body)).status, 403);
    check(403, "unseal");
    state.databaseError = true;
    await assert.rejects(request(body), /private-database-url/);
    check(500, "database");
    assert.ok(!logs.join("\n").includes("private-"));
    assert.ok(!logs.join("\n").includes("url_verification"));
  } finally {
    console.info = original;
    state.databaseError = false;
  }
});

test("超过一秒只记录一次当前阶段，完成后清理计时器", async (t) => {
  const logs: string[] = [];
  const original = console.info;
  console.info = (line: string) => { logs.push(line); };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (response: Response) => void;
  try {
    const pending = withCallbackDiagnostics(async (stage) => {
      stage("binding");
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    t.mock.timers.tick(1000);
    assert.deepEqual(logs.map((line) => JSON.parse(line).event), [
      "feishu_callback_received", "feishu_callback_slow",
    ]);
    const slow = JSON.parse(logs[1]);
    assert.equal(slow.stage, "binding");
    assert.deepEqual(Object.keys(slow).sort(), ["durationMs", "event", "requestId", "stage"]);
    assert.ok(slow.durationMs >= 0);
    t.mock.timers.tick(2000);
    assert.equal(logs.length, 2);
    finish(Response.json({ ok: true }));
    await pending;
    assert.equal(JSON.parse(logs.at(-1)!).event, "feishu_callback_completed");
    t.mock.timers.tick(10000);
    assert.equal(logs.length, 3);
    logs.length = 0;
    await withCallbackDiagnostics(async () => Response.json({ ok: true }));
    t.mock.timers.tick(1000);
    assert.deepEqual(logs.map((line) => JSON.parse(line).event), [
      "feishu_callback_received", "feishu_callback_completed",
    ]);
  } finally {
    console.info = original;
    t.mock.timers.reset();
  }
});

test("日志写入异常不影响响应或原始异常传播", async () => {
  const original = console.info;
  console.info = () => { throw new Error("logger unavailable"); };
  try {
    const response = Response.json({ ok: true });
    assert.equal(await withCallbackDiagnostics(async () => response), response);
    const failure = new Error("original failure");
    await assert.rejects(withCallbackDiagnostics(async (stage) => {
      stage("database");
      throw failure;
    }), (error) => error === failure);
  } finally {
    console.info = original;
  }
});
