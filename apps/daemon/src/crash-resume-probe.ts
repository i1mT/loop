// 崩溃后恢复的继续性：会话中途杀掉智能体进程 → 新进程 load → 再发一条 prompt，看它是否还记得上下文。
import { withAgent, runPrompt, type AgentKind } from "./harness.ts";
const [kind = "claude", repo = process.cwd()] = process.argv.slice(2) as [AgentKind, string];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let sid = "";
// 第一步：先完成一轮，让它记住一个口令
await withAgent(kind, repo, { decide: "allow" }, async (a) => {
  const s = await a.cx.buildSession(repo).start();
  sid = s.sessionId;
  await runPrompt(s, "Remember this passphrase exactly: MAGENTA-HERON-42. Reply only 'stored'.");
});
// 第二步：开始长任务后杀掉进程（模拟崩溃）
await withAgent(kind, repo, { decide: "allow" }, async (a) => {
  const s = await a.cx.buildSession(repo).start();
  const p = s.prompt("Count from 1 to 300 slowly, one number per line.").catch(() => undefined);
  await sleep(2500);
  a.child.kill("SIGKILL");
  await p;
}).catch(() => undefined);
// 第三步：新进程加载旧会话，问口令
let answer = "";
await withAgent(kind, repo, { decide: "allow" }, async (a) => {
  await a.cx.request("session/load", { sessionId: sid, cwd: repo, mcpServers: [] });
  const before = a.updates.length;
  await a.cx.request("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "What was the passphrase? Reply with only the passphrase." }] });
  answer = a.updates.slice(before).filter((u) => u.sessionUpdate === "agent_message_chunk").map((u: any) => u.content?.text ?? "").join("");
});
console.log(JSON.stringify({ kind, recalledPassphrase: answer.includes("MAGENTA-HERON-42"), answer: answer.slice(0, 120) }));
