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
  }finally{
    clearTimeout(timer);server.close();await once(server,"close");
  }
});
