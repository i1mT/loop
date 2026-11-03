// ACP 探测用的最小宿主：启动智能体子进程，所有操作都在 connectWith 的回调里完成（与 probe.ts 同一写法）。
// 仅供实测与后续适配器参考，不含业务逻辑。
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

export type AgentKind = "claude" | "codex" | "opencode" | "grok" | "pi" | "dsh";

// 适配器用本包的 node_modules/.bin 绝对路径启动，避免 pnpm 在测试仓库目录里找不到工作区
const LOCAL_BIN = new URL("../node_modules/.bin/", import.meta.url).pathname;
const COMMANDS: Record<AgentKind, string[]> = {
  claude: [LOCAL_BIN + "claude-agent-acp"],
  codex: [LOCAL_BIN + "codex-acp"],
  opencode: ["opencode", "acp"],
  grok: ["grok", "agent", "stdio"],
  pi: [LOCAL_BIN + "pi-acp"],
  dsh: [LOCAL_BIN + "dsh", "--profile", "acp"],
};

export interface PermissionPolicy {
  decide: "allow" | "reject";
}

export interface AgentHandle {
  child: ChildProcess;
  cx: acp.ClientContext;
  permissions: unknown[];
  /** 全部 session/update 通知（含 load 时的历史重放） */
  updates: acp.SessionUpdate[];
}

export async function withAgent<T>(
  kind: AgentKind,
  cwd: string,
  policy: PermissionPolicy,
  op: (a: AgentHandle) => Promise<T>,
): Promise<T> {
  const [bin, ...args] = COMMANDS[kind];
  // PROBE_NO_PROXY=1 时去掉代理变量，用于对比 grok 经代理的 502 噪声
  const env = { ...process.env };
  if (process.env.PROBE_NO_PROXY === "1") for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY"]) delete env[k];
  const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "ignore"] });
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
  );
  const permissions: unknown[] = [];
  const updates: acp.SessionUpdate[] = [];
  const app = acp.client({ name: "loop-findings" })
    .onNotification("session/update", ({ params }) => {
      updates.push(params.update);
    }).onRequest("session/request_permission", async ({ params }) => {
    permissions.push(params);
    const want = policy.decide === "allow" ? "allow_once" : "reject_once";
    const opt = params.options.find((o) => o.kind === want) ?? params.options[params.options.length - 1];
    return { outcome: { outcome: "selected", optionId: opt.optionId } };
  });
  try {
    return await app.connectWith(stream, async (cx) => {
      await cx.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      return op({ child, cx, permissions, updates });
    });
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

/** 跑一轮 prompt，收集全部更新直到 stop */
export async function runPrompt(session: acp.ActiveSession, text: string) {
  const updates: acp.SessionUpdate[] = [];
  const p = session.prompt(text).catch(() => undefined);
  let stopReason = "unknown";
  for (;;) {
    const m = await session.nextUpdate();
    if (m.kind === "stop") {
      stopReason = m.stopReason;
      break;
    }
    updates.push(m.update);
  }
  await p;
  return { stopReason, updates };
}
