// 真实智能体的端到端冒烟：同一进程内启动任务，遇到 needs_you 时由脚本模拟人工选择允许一次。
// 用法：node --experimental-strip-types src/smoke/run-agent.ts <agent> <repoDir> "<prompt>"
// 只能用于一次性测试仓库（见 AGENTS.md）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LoopDaemon } from "../daemon.ts";
import { tempDir } from "../testing/fixtures.ts";

const [agent = "claude", repo = "", prompt = ""] = process.argv.slice(2);
if (!repo || !prompt) throw new Error("用法：run-agent.ts <agent> <repoDir> <prompt>");

const d = new LoopDaemon({ dataDir: tempDir("loopd-smoke-") });
const human: string[] = [];
d.on("state", (id: string) => {
  const m = d.store.getMeta(id);
  if (m?.state !== "needs_you") return;
  // 模拟人工：读取待决的权限请求，选择允许一次
  const req = d.store.read(id).filter((e) => e.kind === "permission_request").pop();
  const opts = (req?.payload as { options?: { optionId: string; kind: string }[] })?.options ?? [];
  const allow = opts.find((o) => o.kind === "allow_once");
  if (req && allow) {
    human.push(`允许：${(req.payload as { title: string }).title}`);
    d.answer(id, (req.payload as { requestId: string }).requestId, allow.optionId);
  }
});

const id = await d.start({ taskId: "smoke", repo, agent, prompt });
const m = await d.waitFor(id, ["idle", "cancelled", "crashed", "failed", "ended"], 10 * 60_000);
const es = d.store.read(id);
const summary = {
  agent,
  sessionId: id,
  state: m.state,
  stopReason: m.stopReason,
  worktree: m.cwd,
  humanDecisions: human,
  eventCounts: es.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {}),
  diffs: es.filter((e) => e.kind === "diff").map((e) => (e.payload as { path: string; change: string }).path),
  errors: es.filter((e) => e.kind === "error").map((e) => (e.payload as { message: string }).message).slice(0, 3),
  statusDetails: es.filter((e) => e.kind === "status" && (e.payload as { detail?: string }).detail).map((e) => (e.payload as { detail: string }).detail).slice(0, 3),
  agentText: es.filter((e) => e.kind === "message" && (e.payload as { role: string }).role === "agent").map((e) => (e.payload as { text: string }).text).join("").slice(0, 300),
};
console.log(JSON.stringify(summary, null, 2));
try {
  console.log("a.txt 当前内容：\n" + readFileSync(join(m.cwd, "a.txt"), "utf8"));
} catch {
  // 文件不存在则忽略
}
await d.close();
