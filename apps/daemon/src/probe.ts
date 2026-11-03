// 探针：用 ACP 驱动一个智能体，打印会话事件。用法：node --experimental-strip-types src/probe.ts <claude|codex> <cwd> "<prompt>"
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";
import * as acp from "@agentclientprotocol/sdk";

const [kind = "claude", cwd = process.cwd(), prompt = "Reply with exactly one word: pong. Do not use any tools."] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const bins: Record<string, string> = {
  claude: "@agentclientprotocol/claude-agent-acp/dist/index.js",
  codex: "@agentclientprotocol/codex-acp",
};

const COMMANDS: Record<string, string[]> = {
  claude: ["pnpm", "exec", "claude-agent-acp"],
  codex: ["pnpm", "exec", "codex-acp"],
  opencode: ["opencode", "acp"],
  grok: ["grok", "agent", "stdio"],
};
const [bin, ...args] = COMMANDS[kind];
const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "inherit"] });
void bins; void require;
const stream = acp.ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>);

const app = acp
  .client({ name: "loop-probe" })
  .onRequest("session/request_permission", async ({ params }) => {
    console.log("[permission]", JSON.stringify(params).slice(0, 300));
    const allow = params.options.find((o) => o.kind === "allow_once") ?? params.options[0];
    return { outcome: { outcome: "selected", optionId: allow.optionId } };
  });

await app.connectWith(stream, async (cx) => {
  const init = await cx.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
  console.log("[init]", JSON.stringify(init).slice(0, 400));
  const session = await cx.buildSession(cwd).start();
  console.log("[session]", session.sessionId);
  const p = session.prompt(prompt);
  for (;;) {
    const m = await session.nextUpdate();
    if (m.kind === "stop") { console.log("[stop]", m.stopReason); break; }
    console.log("[update]", JSON.stringify(m.update).slice(0, 300));
  }
  await p;
});
child.kill();
