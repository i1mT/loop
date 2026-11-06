import { fileURLToPath } from "node:url";
// 智能体规格：所有智能体都以“免审批”方式启动（用户明确要求，任务都在一次性 worktree 里执行）。
// 结论来源：docs/contracts/acp-findings.md（P-13、P-15、P-18）。
import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSpec } from "./acp/agent-conn.ts";
import { commonGitDir, type Worktree } from "./worktree.ts";

// 适配器用本包 node_modules/.bin 的绝对路径，避免 pnpm 在测试仓库目录里找不到工作区（P-8）
const LOCAL_BIN = fileURLToPath(new URL("../node_modules/.bin/", import.meta.url));
const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY"];

export const BUILTIN_SPECS: Record<string, AgentSpec> = {
  claude: { kind: "claude", command: LOCAL_BIN + "claude-agent-acp", args: [], mode: "bypassPermissions" },
  codex: { kind: "codex", command: LOCAL_BIN + "codex-acp", args: [], mode: "agent-full-access" },
  // opencode 的 --auto/--yolo 只在主命令和 run 上，acp 子命令不认；ACP 经后台服务执行，传给 acp 进程的配置/环境变量未必生效，所以由守护进程自动批准
  opencode: { kind: "opencode", command: "opencode", args: ["acp"], autoApprove: true },
  // pi 本身没有权限系统；适配器 pi-acp 起 `pi --mode rpc`，pi 须在 PATH 上
  pi: { kind: "pi", command: LOCAL_BIN + "pi-acp", args: [] },
  // DeepSeek Harness：用本包依赖的 @deepseek-ai/dsh（固定 0.2.1-rc.2；PATH 上桌面版的 0.1.x 没有 acp 配置）。danger-full-access 同时关闭沙箱与审批（dsh-base 的 DSH_PERMISSION_MODE）
  dsh: { kind: "dsh", command: LOCAL_BIN + "dsh", args: ["--profile", "acp"], env: { DSH_PERMISSION_MODE: "danger-full-access" } },
  grok: { kind: "grok", command: "grok", args: ["agent", "--always-approve", "stdio"], stripEnv: PROXY_VARS },
};

export async function excludeFromGit(wt: Worktree, patterns: string[]): Promise<void> {
  if (patterns.length === 0) return;
  const file = join(await commonGitDir(wt), "info", "exclude");
  mkdirSync(dirname(file), { recursive: true });
  const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
  const missing = patterns.filter((p) => !cur.split("\n").includes(p));
  if (missing.length) appendFileSync(file, `\n# loop-daemon\n${missing.join("\n")}\n`);
}
