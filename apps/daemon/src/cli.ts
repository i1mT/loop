#!/usr/bin/env node
import { connectionCommand } from "./connection/commands.ts";
import { readConnection } from "./connection/config.ts";
import { lockDaemon } from "./connection/process.ts";
// loopd 命令行：本地验证与手动操作入口。数据目录默认 ~/.loop-daemon，可用 LOOPD_HOME 覆盖。
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LoopDaemon } from "./daemon.ts";
import { defaultDaemonId, serve } from "./serve.ts";

const dataDir = process.env.LOOPD_HOME ?? join(homedir(), ".loop-daemon");
const [cmd, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] ?? "true" : undefined;
}

function print(x: unknown): void {
  console.log(JSON.stringify(x, null, 2));
}

async function main(): Promise<void> {
  if (await connectionCommand(cmd, flag, dataDir)) return;
  const d = new LoopDaemon({ dataDir });
  try {
    switch (cmd) {
      case "run": {
        // loopd run --agent claude --repo <path> --prompt "..." [--main main]
        const agent = flag("agent") ?? "claude";
        const repo = flag("repo");
        const prompt = flag("prompt");
        if (!repo || !prompt) throw new Error("用法：loopd run --agent <claude|codex|opencode|grok> --repo <path> --prompt <text> [--main main]");
        const id = await d.start({ taskId: `t-${randomUUID().slice(0, 8)}`, repo, agent, prompt, mainRef: flag("main") });
        const m = await d.waitFor(id, ["idle", "needs_you", "cancelled", "crashed", "failed", "ended"], 30 * 60_000);
        print({ sessionId: id, state: m.state, worktree: m.cwd, branch: m.branch, stopReason: m.stopReason });
        break;
      }
      case "events": {
        const id = rest[0];
        for (const e of d.store.read(id, Number(flag("after") ?? -1))) console.log(JSON.stringify(e));
        break;
      }
      case "answer": {
        const [id, requestId, optionId] = rest;
        d.answer(id, requestId, optionId);
        print({ ok: true });
        break;
      }
      case "reply": {
        const [id, ...text] = rest;
        await d.resume(id).catch(() => undefined);
        d.reply(id, text.join(" "));
        print({ ok: true });
        break;
      }
      case "cancel":
        await d.cancel(rest[0]);
        print({ ok: true });
        break;
      case "resume":
        await d.resume(rest[0]);
        print({ ok: true, state: d.store.getMeta(rest[0])?.state });
        break;
      case "serve": {
        // loopd serve：LOOPD_GATEWAY 与 LOOPD_DAEMON_TOKEN 从环境变量读取（令牌不写入仓库）
        const saved = readConnection(dataDir);
        const gateway = process.env.LOOPD_GATEWAY ?? saved?.gateway;
        const token = process.env.LOOPD_DAEMON_TOKEN ?? saved?.token;
        if (!gateway || !token) throw new Error("需要环境变量 LOOPD_GATEWAY 与 LOOPD_DAEMON_TOKEN");
        const ac = new AbortController();
        process.on("SIGINT", () => ac.abort());
        process.on("SIGTERM", () => ac.abort());
        const unlock = lockDaemon(dataDir);
        try {
          await serve({ gateway, token, daemonId: process.env.LOOPD_MACHINE_ID ? defaultDaemonId() : saved?.machineId ?? defaultDaemonId(), machineName: process.env.LOOPD_MACHINE_NAME, dataDir, signal: ac.signal });
        } finally { unlock(); }
        return; // serve 结束后不再执行 finally 之外的逻辑
      }
      case "recover":
        print({ crashed: d.recover() });
        break;
      case "list":
        print(d.store.listMetas().map((m) => ({ id: m.id, taskId: m.taskId, agent: m.agent, state: m.state, updatedAt: m.updatedAt })));
        break;
      default:
        console.log("用法：loopd <run|events|answer|reply|cancel|resume|recover|list> ...");
        process.exitCode = 1;
    }
  } finally {
    // 进程结束前关闭仍在运行的智能体（整组）；需要保持运行的会话由 run 的等待语义保证
    await d.close();
  }
}

main().catch((e) => {
  console.error(`错误：${(e as Error).message}`);
  process.exitCode = 1;
});
