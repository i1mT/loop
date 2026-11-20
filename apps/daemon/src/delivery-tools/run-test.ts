import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionMcpServers } from "../acp/agent-conn.ts";
import type { LoopDaemon } from "../daemon.ts";
import type { EnvironmentTestResult } from "../delivery.ts";
import { runPublishInSession } from "../publish-agent.ts";
import { REPORT_TOOL, readReport } from "./result.ts";

const script = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./report-tool.ts" : "./report-tool.js", import.meta.url));
const shellQuote = (arg: string) => `'${arg.replaceAll("'", "'\\''")}'`;

export async function runEnvironmentTest(
  d: LoopDaemon, sid: string, prompt: string, timeoutMs: number, active: () => boolean,
): Promise<EnvironmentTestResult> {
  const dir = mkdtempSync(join(tmpdir(), "loop-test-result-"));
  const args = [script, dir];
  const submit = [process.execPath, ...args, "submit"].map(shellQuote).join(" ");
  const mcpServers: SessionMcpServers = [{ name: "loop", command: process.execPath, args, env: [] }];
  const how = `调用 Loop 的 ${REPORT_TOOL} 工具，传入 verdict（passed、failed 或 blocked）和 summary（测试摘要）。若工具不可见，用终端执行 ${submit} VERDICT '测试摘要'，把 VERDICT 替换为对应的英文值。`;
  try {
    let run = await runPublishInSession(d, sid, `${prompt}\n\n${how}`, timeoutMs, { resetWaiting: true, mcpServers });
    if (!active()) return { verdict: "blocked", output: "任务租约已失效。" };
    let report = readReport(dir);
    if (!report && run.state === "idle") {
      run = await runPublishInSession(d, sid, `请提交刚完成的测试结论。如果测试还未完成，继续验证或提交受阻原因。${how}`, timeoutMs);
      if (!active()) return { verdict: "blocked", output: "任务租约已失效。" };
      report = readReport(dir);
    }
    if (run.state !== "idle") await d.cancel(sid, { local: true }).catch(() => undefined);
    if (report) return { verdict: report.verdict, output: report.summary };
    return run.state === "idle"
      ? { verdict: "unclear", output: "智能体没有调用工具提交测试结论。" }
      : { verdict: "blocked", output: "环境测试会话中断，请查看会话后重试。" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
