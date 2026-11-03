// 排查：用工程师提示词模板 + 任务内容直接跑一轮真实智能体（不经网关）
import { LoopDaemon } from "../daemon.ts";
import { buildPrompt } from "../serve.ts";
import { tempDir } from "../testing/fixtures.ts";

const [agent = "claude", repo = "", body = ""] = process.argv.slice(2);
const d = new LoopDaemon({ dataDir: tempDir("loopd-prompt-") });
d.on("state", (id: string) => {
  const m = d.store.getMeta(id);
  if (m?.state !== "needs_you") return;
  const req = d.store.read(id).filter((e) => e.kind === "permission_request").pop();
  const opts = (req?.payload as { options?: { optionId: string; kind: string }[] })?.options ?? [];
  const allow = opts.find((o) => o.kind === "allow_once");
  if (req && allow) {
    console.log("permission:", (req.payload as { title: string }).title);
    d.answer(id, (req.payload as { requestId: string }).requestId, allow.optionId);
  }
});
const id = await d.start({ taskId: "prompt-check", repo, agent, prompt: buildPrompt("闭环任务一", body) });
const m = await d.waitFor(id, ["idle", "cancelled", "crashed", "failed", "ended"], 240_000).catch((e) => ({ state: `超时：${(e as Error).message}` }));
console.log(JSON.stringify({ state: (m as { state: string }).state, events: d.store.read(id).map((e) => e.kind).slice(-12) }));
await d.close();
