// 阶段 01 实测：改文件/权限/diff、恢复、取消、崩溃、权限拒绝。
// 用法：EVID_DIR=<目录> node --experimental-strip-types src/findings.ts <agent> <repoDir>
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withAgent, runPrompt, type AgentKind } from "./harness.ts";

const [kind = "claude", repo = process.cwd()] = process.argv.slice(2) as [AgentKind, string];
const EVID = process.env.EVID_DIR ?? process.cwd();
const out: Record<string, unknown> = { agent: kind, repo, startedAt: new Date().toISOString() };
const log = (k: string, v: unknown) => {
  out[k] = v;
  console.log(`== ${k}`, JSON.stringify(v).slice(0, 500));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// opencode 的权限由它自己的配置决定（默认放行），测试仓库里写入 ask 配置才能测到权限路径。只写在一次性测试仓库里。
if (kind === "opencode") {
  writeFileSync(join(repo, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", permission: { edit: "ask", bash: "ask", webfetch: "ask" } }));
}

// 1) 改文件 + 权限请求 + 工具/diff 事件（default 模式，允许）
let sid = "";
await withAgent(kind, repo, { decide: "allow" }, async (a) => {
  const s = await a.cx.buildSession(repo).start();
  sid = s.sessionId;
  await a.cx.request("session/set_mode", { sessionId: s.sessionId, modeId: process.env.PROBE_MODE ?? (kind === "codex" ? "read-only" : "default") }).catch(() => undefined);
  const r = await runPrompt(s, "Append the line 'probe-edit' to the end of a.txt using a file edit tool. Then reply with the single word done.");
  log("edit.stopReason", r.stopReason);
  log("edit.permissionRequests", a.permissions.length);
  log("edit.permissionSample", a.permissions[0] ?? null);
  const tools = r.updates.filter((u) => u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update");
  log("edit.toolUpdateCount", tools.length);
  log("edit.toolSample", tools.slice(0, 2));
  log("edit.diffSeen", JSON.stringify(r.updates).includes('"diff"'));
  log("edit.toolKinds", [...new Set(tools.map((u: any) => `${u.kind ?? "-"}:${u.name ?? "-"}`))]);
});

// 2) 恢复：新进程 load 旧会话，再问它上一轮做了什么
await withAgent(kind, repo, { decide: "allow" }, async (a) => {
  const loaded = await a.cx.request("session/load", { sessionId: sid, cwd: repo, mcpServers: [] }).then(
    () => "ok",
    (e: Error) => `error: ${e.message.slice(0, 200)}`,
  );
  log("resume.load", loaded);
  log("resume.replayUpdateCount", a.updates.length);
  if (loaded === "ok") {
    // 继续同一会话：问它上一轮做了什么。能答出 a.txt 或 probe-edit 才算上下文真的恢复
    const before = a.updates.length;
    await a.cx.request("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "In one short sentence: which file did you edit in your previous turn, and what line did you add?" }] }).then(
      () => "ok",
      (e: Error) => `error: ${e.message.slice(0, 160)}`,
    );
    const text = a.updates.slice(before).filter((u) => u.sessionUpdate === "agent_message_chunk").map((u: any) => u.content?.text ?? "").join("");
    log("resume.answerAfterLoad", text.slice(0, 300));
  }
});

// 3) 取消：长任务中途 cancel，记录 stopReason 与耗时
await withAgent(kind, repo, { decide: "allow" }, async (a) => {
  const s = await a.cx.buildSession(repo).start();
  const p = s.prompt("Count from 1 to 300 slowly, one number per line, in separate messages.").catch(() => undefined);
  await sleep(4000);
  const t0 = Date.now();
  await a.cx.notify("session/cancel", { sessionId: s.sessionId });
  let stop = "none";
  for (;;) {
    const m = await Promise.race([s.nextUpdate(), sleep(10000).then(() => null)]);
    if (!m) { stop = "timeout-10s"; break; }
    if (m.kind === "stop") { stop = m.stopReason; break; }
  }
  await p;
  log("cancel.stopReason", stop);
  log("cancel.latencyMs", Date.now() - t0);
});

// 4) 崩溃：prompt 中途杀掉智能体进程
let crashSid = "";
await withAgent(kind, repo, { decide: "allow" }, async (a) => {
  const s = await a.cx.buildSession(repo).start();
  crashSid = s.sessionId;
  const p = s.prompt("Count from 1 to 300 slowly, one number per line.").then(
    () => "resolved",
    (e: Error) => `rejected: ${e.message.slice(0, 120)}`,
  );
  await sleep(3000);
  a.child.kill("SIGKILL");
  log("crash.promiseAfterKill", await Promise.race([p, sleep(5000).then(() => "pending-after-5s")]));
}).catch((e: Error) => log("crash.outerError", e.message.slice(0, 160)));
await withAgent(kind, repo, { decide: "allow" }, async (a) => {
  const r = await a.cx.request("session/load", { sessionId: crashSid, cwd: repo, mcpServers: [] }).then(
    () => "ok",
    (e: Error) => `error: ${e.message.slice(0, 200)}`,
  );
  log("crash.loadAfterRestart", r);
}).catch((e: Error) => log("crash.restartError", e.message.slice(0, 200)));

// 各智能体"需要批准才能改文件"的模式：claude=default（Manual），codex=read-only
const MODE = process.env.PROBE_MODE ?? (kind === "codex" ? "read-only" : "default");
// 5) 权限：default 模式下编辑必须询问；拒绝后能否收尾
await withAgent(kind, repo, { decide: "reject" }, async (a) => {
  const s = await a.cx.buildSession(repo).start();
  const setRes = await a.cx.request("session/set_mode", { sessionId: s.sessionId, modeId: MODE }).then(
    () => "ok",
    (e: Error) => `error: ${e.message.slice(0, 160)}`,
  );
  log("mode.setResult", setRes);
  // WebFetch 不在用户全局 allow 列表里，用它来触发权限请求（不改动用户设置）
  const rejectPrompt =
    kind === "codex"
      ? "Append the line 'reject-probe' to the end of a.txt. If you are not allowed to edit, reply exactly 'blocked'."
      : "Use the WebFetch tool to fetch https://example.com and then reply with the word 'fetched' or 'blocked' if the tool was refused.";
  const r = await runPrompt(s, rejectPrompt);
  log("reject.stopReason", r.stopReason);
  log("reject.answer", r.updates.filter((u) => u.sessionUpdate === "agent_message_chunk").map((u: any) => u.content?.text ?? "").join("").slice(0, 300));
  log("reject.permissionRequests", a.permissions.length);
  log("reject.permissionSample", a.permissions[0] ?? null);
});

writeFileSync(`${EVID}/findings-${kind}.json`, JSON.stringify(out, null, 2));
console.log("written", `${EVID}/findings-${kind}.json`);
