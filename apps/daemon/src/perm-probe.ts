// 单独验证：某个智能体在给定仓库配置下，编辑与联网是否触发权限请求，以及拒绝后的行为。
import { withAgent, runPrompt, type AgentKind } from "./harness.ts";
const [kind = "opencode", repo = process.cwd()] = process.argv.slice(2) as [AgentKind, string];
const prompt = process.env.PROBE_PROMPT ?? "Use the WebFetch or fetch tool to get https://example.com . If a permission was refused, reply 'refused'; otherwise reply 'fetched'.";
await withAgent(kind, repo, { decide: "reject" }, async (a) => {
  const s = await a.cx.buildSession(repo).start();
  const r = await runPrompt(s, prompt);
  const answer = r.updates.filter((u) => u.sessionUpdate === "agent_message_chunk").map((u: any) => u.content?.text ?? "").join("");
  console.log(JSON.stringify({ kind, stop: r.stopReason, permissionRequests: a.permissions.length, answer: answer.slice(0, 200) }));
});
