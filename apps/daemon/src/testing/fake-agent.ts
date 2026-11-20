// 假 ACP 智能体，仅用于测试。按提示词里的关键字触发场景：
//   write:<相对路径>:<内容>  编辑文件（需要权限）
//   danger                    执行一个非安全命令（需要权限）
//   sleep                     启动孙进程并长时间运行，直到被取消（孙进程 pid 写入 FAKE_PID_FILE）
//   crash                     发出一条消息后直接退出（模拟崩溃）
//   silent                    不输出任何内容就 end_turn（模拟被适配器吞掉的模型报错）
//   其它                      回显
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const cwds = new Map<string, string>();
const cancelled = new Set<string>();
const OPTIONS = [
  { optionId: "allow", name: "允许", kind: "allow_once" },
  { optionId: "reject", name: "拒绝", kind: "reject_once" },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Client = { notify: (m: string, p: unknown) => Promise<void>; request: (m: string, p: unknown) => Promise<any> };

async function say(client: Client, sessionId: string, text: string): Promise<void> {
  await client.notify("session/update", { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
}

async function ask(client: Client, sessionId: string, toolCall: Record<string, unknown>): Promise<boolean> {
  const r = await client.request("session/request_permission", { sessionId, toolCall, options: OPTIONS });
  return r.outcome?.outcome === "selected" && r.outcome.optionId === "allow";
}

async function runPrompt(sessionId: string, text: string, client: Client): Promise<{ stopReason: acp.StopReason }> {
  const cwd = cwds.get(sessionId) ?? process.cwd();

  if (process.env.FAKE_DELIVERY === "1") {
    if (text.includes("本轮要求：先形成技术方案")) {
      const plan = ["背景", "目标", "技术实现", "改动点", "验证方式", "风险与回滚"]
        .map((section) => `## ${section}\n说明在一次性仓库里的实现、验证与维护步骤。`).join("\n");
      await say(client, sessionId, `<loop-technical-plan>\n# 交付流程验证\n${plan}\n</loop-technical-plan>`);
      return { stopReason: "end_turn" };
    }
    if (text.includes("【Loop 方案执行")) {
      writeFileSync(join(cwd, "delivery-fixture.txt"), "example\n");
      await say(client, sessionId, "已完成一次性仓库的改动。");
      return { stopReason: "end_turn" };
    }
    if (text.includes("环境流水线已成功") && text.includes("fixture password")) {
      const output = process.env.FAKE_PREVIEW_FAILURE ? "已执行环境测试，预览字号仍不正确。" : "已执行环境测试。\n测试结果：通过";
      await say(client, sessionId, output);
      return { stopReason: "end_turn" };
    }
    if (process.env.FAKE_PREVIEW_FAILURE && text.includes("根据刚完成的测试报告补充结论")) {
      await say(client, sessionId, "测试结果:失败");
      return { stopReason: "end_turn" };
    }
  }

  const w = text.match(/write:([^:]+):(.*)/s);
  if (w) {
    const [, rel, content] = w;
    const path = join(cwd, rel);
    const toolCall = { toolCallId: `tc-${randomUUID().slice(0, 8)}`, title: `编辑 ${rel}`, kind: "edit", status: "pending", locations: [{ path }], rawInput: { file_path: path } };
    await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call", ...toolCall } });
    if (await ask(client, sessionId, toolCall)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${content}\n`);
      await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: toolCall.toolCallId, status: "completed" } });
      await say(client, sessionId, `已写入 ${rel}`);
    } else {
      await client.notify("session/update", { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: toolCall.toolCallId, status: "failed" } });
      await say(client, sessionId, "编辑被拒绝");
    }
    return { stopReason: "end_turn" };
  }

  // commitfile:<路径>:<内容> 写入文件并提交到任务分支（用于测试主分支前进后的自愈）
  const c = text.match(/commitfile:([^:]+):(.*)/s);
  if (c) {
    const [, rel, content] = c;
    mkdirSync(dirname(join(cwd, rel)), { recursive: true });
    writeFileSync(join(cwd, rel), `${content}\n`);
    execFileSync("git", ["add", "-A"], { cwd });
    execFileSync("git", ["commit", "-q", "-m", `fake: ${rel}`], { cwd });
    await say(client, sessionId, `已提交 ${rel}`);
    return { stopReason: "end_turn" };
  }

  if (text.includes("danger")) {
    const toolCall = { toolCallId: `tc-${randomUUID().slice(0, 8)}`, title: "执行 rm", kind: "execute", status: "pending", rawInput: { command: "rm -rf build" } };
    if (await ask(client, sessionId, toolCall)) await say(client, sessionId, "已执行");
    else await say(client, sessionId, "命令被拒绝");
    return { stopReason: "end_turn" };
  }

  if (text.includes("sleep")) {
    const gc = spawn("sleep", ["300"], { stdio: "ignore" });
    if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(gc.pid));
    for (let i = 0; i < 400; i++) {
      if (cancelled.has(sessionId)) {
        cancelled.delete(sessionId);
        return { stopReason: "cancelled" };
      }
      await sleep(50);
    }
    return { stopReason: "end_turn" };
  }

  if (text.includes("publish-progress")) {
    for (let i = 0; i < 8; i++) {
      await say(client, sessionId, `发布步骤 ${i + 1}\n`);
      await sleep(50);
    }
    await say(client, sessionId, "发布结果：成功");
    return { stopReason: "end_turn" };
  }

  if (text.includes("stall")) {
    // 不输出任何内容，直到被取消（模拟卡住）
    for (let i = 0; i < 400; i++) {
      if (cancelled.has(sessionId)) {
        cancelled.delete(sessionId);
        return { stopReason: "cancelled" };
      }
      await sleep(50);
    }
    return { stopReason: "end_turn" };
  }

  if (text.includes("silent")) return { stopReason: "end_turn" };

  if (text.includes("crash")) {
    await say(client, sessionId, "即将崩溃");
    await sleep(100);
    process.exit(9);
  }

  await say(client, sessionId, `回显：${text}`);
  return { stopReason: "end_turn" };
}

const app = acp
  .agent({ name: "fake-agent" })
  // FAKE_RESUME_ONLY=1：模拟 dsh——没有 session/load，只有不重放历史的 session/resume
  .onRequest("initialize", async () => ({
    protocolVersion: 1,
    agentCapabilities: process.env.FAKE_RESUME_ONLY ? { sessionCapabilities: { resume: {} } } : { loadSession: true },
  }))
  .onRequest("session/new", async ({ params }) => {
    const sessionId = randomUUID();
    cwds.set(sessionId, params.cwd);
    return { sessionId };
  })
  .onRequest("session/set_mode", async () => ({}))
  .onRequest("session/resume", async ({ params }) => {
    if (!process.env.FAKE_RESUME_ONLY) throw new Error("resume 不可用");
    cwds.set(params.sessionId, params.cwd);
    return {};
  })
  .onRequest("session/load", async ({ params, client }) => {
    cwds.set(params.sessionId, params.cwd);
    // 模拟历史重放：守护进程必须丢弃它
    await say(client as unknown as Client, params.sessionId, "（历史重放）");
    return {};
  })
  .onNotification("session/cancel", async ({ params }) => {
    cancelled.add(params.sessionId);
  })
  .onRequest("session/prompt", async ({ params, client }) => runPrompt(params.sessionId, params.prompt.map((b) => ("text" in b ? b.text : "")).join(""), client as unknown as Client));

await app.connectWith(
  acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>),
  async () => {
    await new Promise<void>((r) => process.stdin.on("end", r));
  },
);
