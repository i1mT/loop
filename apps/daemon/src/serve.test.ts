import { test } from "node:test";
import assert from "node:assert/strict";
import { BUSY_TICK_MS, IDLE_TICK_MS, WAITING_TICK_MS, nextTickMs } from "./serve.ts";

test("没有任何任务：每 60 秒一次", () => {
  assert.equal(nextTickMs([], false), 60_000);
  assert.equal(IDLE_TICK_MS, 60_000);
});

test("会话都空闲（等人审核或评论）：20 秒，且必须小于 60 秒的租约", () => {
  assert.equal(nextTickMs(["idle", "idle"], false), WAITING_TICK_MS);
  assert.ok(WAITING_TICK_MS < 60_000 / 2, "租约 60 秒，续租间隔要留出余量");
});

test("有会话在运行、等权限、启动中或有发布任务：每秒一次", () => {
  assert.equal(nextTickMs(["running"], false), BUSY_TICK_MS);
  assert.equal(nextTickMs(["idle", "needs_you"], false), BUSY_TICK_MS);
  assert.equal(nextTickMs(["starting"], false), BUSY_TICK_MS);
  assert.equal(nextTickMs(["idle"], true), BUSY_TICK_MS, "发布中要快速上报结果");
});

import { buildPrompt } from "./serve.ts";

test("提示词：项目全局指令放在任务之前；没有指令时不出现该段；超长截断", () => {
  const withIns = buildPrompt("改标题", "说明", false, "  这个项目用 pnpm，不要改 legacy/ 目录。 ");
  assert.match(withIns, /## 项目说明/);
  assert.ok(withIns.indexOf("这个项目用 pnpm") < withIns.indexOf("## 任务"), "指令在任务之前");
  assert.doesNotMatch(buildPrompt("改标题", "说明", false, "   "), /## 项目说明/);
  assert.doesNotMatch(buildPrompt("改标题", "说明"), /## 项目说明/);
  assert.ok(buildPrompt("t", "b", false, "x".repeat(20000)).length < 20000);
});


import { createServer } from "node:http";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LoopDaemon } from "./daemon.ts";
import { serve } from "./serve.ts";
import { FakeForge } from "./testing/fake-forge.ts";
import { FAKE_SPEC, git, tempDir } from "./testing/fixtures.ts";

test("重新接管时先投递冲突处理消息，不能先回传旧提交供审核", async () => {
  const forge = new FakeForge();
  const dataDir = tempDir("loopd-inbox-order-");
  const repo = await forge.ensureCheckout({githubRepo:"o/r",dataDir});
  const d = new LoopDaemon({dataDir,specs:{fake:FAKE_SPEC}});
  const sid = await d.start({taskId:"repair",repo,agent:"fake",prompt:"你好",mainRef:"origin/main"});
  await d.waitFor(sid);
  const meta=d.store.getMeta(sid)!;
  writeFileSync(join(meta.cwd,"task.txt"),"old task change\n");
  git(meta.cwd,"add","-A");git(meta.cwd,"commit","-m","old task");
  await d.close();
  const controller=new AbortController();
  const requests:string[]=[];
  let claimed=false;
  const server=createServer((req,res)=>{
    requests.push(req.url!);
    let result:unknown={ok:true};
    if(req.url==="/api/daemon/claim"){
      result={claim:claimed?null:{leaseId:"lease",task:{id:"repair",title:"repair",body:"",agent:"fake",githubRepo:"o/r",repoPath:repo,mainRef:"main",sessionId:sid,reattach:true,job:"work",prNumber:7,prUrl:"https://fake/pr/7"}}};
      claimed=true;
    }else if(req.url?.includes("/inbox?"))result={items:[{id:1,kind:"message",body:"sleep",requestId:null,optionId:null}]};
    else if(req.url==="/api/daemon/inbox/1/ack")controller.abort();
    res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(result));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    await serve({gateway:`http://127.0.0.1:${(server.address() as {port:number}).port}`,token:"fixture",daemonId:"fixture",dataDir,specs:{fake:FAKE_SPEC},forge,tickMs:1,signal:controller.signal,log:()=>{}});
    assert.ok(requests.includes("/api/daemon/inbox/1/ack"),"修复消息已经投递并确认");
    assert.equal(requests.some(p=>p.endsWith("/head")),false,"开始处理之前不能回传旧提交");
    assert.equal(forge.remoteHead(meta.branch),null,"处理消息之前不能重新推送旧分支");
  } finally {
    clearTimeout(timer);
    server.close();
    await once(server, "close");
  }
});

test("任务 PR 使用网关返回的公开地址，daemon 仍通过原地址回传", async () => {
  const forge = new FakeForge();
  const dataDir = tempDir("loopd-public-url-");
  const repo = await forge.ensureCheckout({ githubRepo: "example/demo", dataDir });
  const daemon = new LoopDaemon({ dataDir, specs: { fake: FAKE_SPEC } });
  const sid = await daemon.start({ taskId: "demo", repo, agent: "fake", prompt: "你好", mainRef: "origin/main" });
  await daemon.waitFor(sid);
  const { cwd } = daemon.store.getMeta(sid)!;
  writeFileSync(join(cwd, "task.txt"), "task change\n");
  git(cwd, "add", "task.txt");
  git(cwd, "commit", "-m", "task change");
  await daemon.close();

  const controller = new AbortController();
  let claimed = false;
  let reported = false;
  const server = createServer((req, res) => {
    let data: unknown = { ok: true };
    if (req.url === "/api/daemon/claim") {
      data = { publicUrl: "https://loop.example.com", claim: claimed ? null : { leaseId: "lease", task: {
        id: "demo", title: "演示任务", body: "说明", githubRepo: "example/demo", mainRef: "main", sessionId: sid, reattach: true, job: "work",
      } } };
      claimed = true;
    } else if (req.url?.endsWith("/head")) {
      reported = true;
      controller.abort();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const { port } = server.address() as { port: number };
    await serve({ gateway: `http://127.0.0.1:${port}`, token: "fixture", daemonId: "fixture", dataDir, specs: { fake: FAKE_SPEC }, forge, tickMs: 10, signal: controller.signal, log: () => {} });
    assert.equal(reported, true);
    assert.match(forge.prs[0].body, /https:\/\/loop\.example\.com\/tasks\/demo/);
  } finally {
    clearTimeout(timer);
    server.close();
    await once(server, "close");
  }
});

test("重试发布时，未加入开发循环的原会话也实时回传输出", async () => {
  const forge = new FakeForge();
  const dataDir = tempDir("loopd-pub-forward-");
  const repo = await forge.ensureCheckout({ githubRepo: "example/demo", dataDir });
  const mergeSha = git(repo, "rev-parse", "HEAD").trim();
  const daemon = new LoopDaemon({ dataDir, specs: { fake: FAKE_SPEC } });
  const sid = await daemon.start({ taskId: "publish", repo, agent: "fake", prompt: "你好", mainRef: "origin/main" });
  await daemon.waitFor(sid);
  await daemon.close();

  const controller = new AbortController();
  const calls: string[] = [];
  let claimed = false;
  const server = createServer(async (req, res) => {
    const url = req.url ?? "";
    let data: unknown = { ok: true };
    if (url === "/api/daemon/claim") {
      data = { claim: claimed ? null : { leaseId: "publish-lease", task: { id: "publish", title: "演示发布", githubRepo: "example/demo", mainRef: "main", job: "publish", sessionId: sid, mergeSha } } };
      claimed = true;
    } else if (url.includes("/inbox?")) {
      data = { items: [{ id: 1, kind: "message", body: "publish-progress" }] };
    } else if (url.endsWith("/events")) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        leaseId: string;
        events: { payload: { role?: string; text?: string } }[];
      };
      const replies = body.events.filter((event) => event.payload.role === "agent");
      if (body.leaseId === "publish-lease" && replies.some((event) => event.payload.text?.includes("发布步骤 1"))) {
        calls.push("progress");
      }
      if (replies.some((event) => event.payload.text?.includes("发布结果：成功"))) calls.push("result-event");
    } else if (url.endsWith("/complete")) {
      calls.push("complete");
      controller.abort();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    await serve({ gateway: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: "fixture", daemonId: "fixture", dataDir, specs: { fake: FAKE_SPEC }, forge, tickMs: 10, signal: controller.signal, log: () => {} });
    assert.deepEqual(calls, ["progress", "result-event", "complete"]);
  } finally {
    clearTimeout(timer);
    server.close();
    await once(server, "close");
  }
});

for (const preview of [false, true]) {
  test(preview ? "原会话补充测试结论，失败后请求修复" : "重启后在原会话测试生产环境，并回传回归结论", async () => {
    const forge = new FakeForge();
    const dataDir = tempDir("loopd-regression-");
    const repo = await forge.ensureCheckout({ githubRepo: "example/demo", dataDir });
    const sha = git(repo, "rev-parse", "HEAD").trim();
    if (preview) git(repo, "push", "origin", "HEAD:dev");
    const specs = { fake: { ...FAKE_SPEC, env: { FAKE_DELIVERY: "1", ...(preview ? { FAKE_PREVIEW_FAILURE: "1" } : {}) } } };
    const daemon = new LoopDaemon({ dataDir, specs });
    const sid = await daemon.start({ taskId: "regression", repo, agent: "fake", prompt: "你好", mainRef: "origin/main" });
    await daemon.waitFor(sid);
    await daemon.close();

    const controller = new AbortController();
    const environment = { url: "https://example.com", username: "tester", password: "fixture password", workflow: "deploy.yml" };
    let claimed = false;
    let result: { next: string; state: { productionResult?: string; previewPassed?: boolean }; repair?: string } | undefined;
    const server = createServer(async (req, res) => {
      let payload: unknown = { ok: true };
      if (req.url === "/api/daemon/claim") {
        payload = { claim: claimed ? null : { leaseId: "regression-lease", task: {
          id: "regression", sessionId: sid, job: "delivery", githubRepo: "example/demo",
          delivery: {
            stage: preview ? "preview_test" : "production_test",
            settings: { preview: environment, production: environment },
            state: preview ? { previewSha: sha } : { productionSha: sha },
          },
        } } };
        claimed = true;
      } else if (req.url?.endsWith("/delivery")) {
        const chunks: Buffer[] = [];
        for await (const part of req) chunks.push(Buffer.from(part));
        result = JSON.parse(Buffer.concat(chunks).toString());
        controller.abort();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const { port } = server.address() as { port: number };
      await serve({ gateway: `http://127.0.0.1:${port}`, token: "fixture", daemonId: "fixture", dataDir, specs, forge, tickMs: 10, signal: controller.signal, log: () => {} });
      assert.equal(result?.next, preview ? "running" : "published");
      if (preview) {
        assert.equal(result?.state.previewPassed, false);
        assert.match(result?.repair ?? "", /预览字号仍不正确/);
      } else {
        assert.match(result?.state.productionResult ?? "", /已执行环境测试/);
      }
    } finally {
      clearTimeout(timer);
      server.close();
      await once(server, "close");
    }
  });
}
