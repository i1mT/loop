// 发现本机装了哪些智能体工具：版本、是否具备 ACP 入口、本机的 Claude 历史会话（只读）。
// 只读取，不修改任何文件；每个探测都有超时，单个失败不影响其它。
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const PROBE_TIMEOUT_MS = 8000;

export interface AgentDiscovery {
  kind: string;
  bin: string;
  installed: boolean;
  version: string | null;
  /** 是否有 ACP 入口（能被守护进程驱动） */
  acp: boolean;
  /** 不能驱动时的原因，便于设置页展示 */
  note: string | null;
}

async function probe(bin: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await run(bin, args, { timeout: PROBE_TIMEOUT_MS, env: { ...process.env, NO_PROXY: "*" } });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (e) {
    return { ok: false, out: (e as Error).message.split("\n")[0] };
  }
}

/** 探测支持的智能体工具：claude、codex、grok、opencode、pi、dsh（DeepSeek Harness）。 */
export async function discoverAgents(): Promise<AgentDiscovery[]> {
  const local = (name: string) => new URL(`../node_modules/.bin/${name}`, import.meta.url).pathname;
  const checks: { kind: string; bin: string; version: string[]; acp: () => Promise<boolean>; note?: string }[] = [
    {
      kind: "claude",
      bin: "claude",
      version: ["--version"],
      // 守护进程用本包自带的 ACP 适配器驱动 Claude
      acp: async () => existsSync(local("claude-agent-acp")),
    },
    { kind: "codex", bin: "codex", version: ["--version"], acp: async () => existsSync(local("codex-acp")) },
    { kind: "grok", bin: "grok", version: ["--version"], acp: async () => (await probe("grok", ["agent", "--help"])).ok },
    { kind: "opencode", bin: "opencode", version: ["--version"], acp: async () => (await probe("opencode", ["acp", "--help"])).ok },
    // pi 本身没有 ACP，由本包自带的适配器 pi-acp 驱动；pi 必须在 PATH 上
    { kind: "pi", bin: "pi", version: ["--version"], acp: async () => existsSync(local("pi-acp")) },
    // dsh 的 help 不占用 stdin/stdout；没有 DEEPSEEK_API_KEY 时能启动，但对话会失败（密钥也可存在 dsh 自己的设置里，所以只做提示）
    {
      kind: "dsh",
      bin: local("dsh"),
      version: ["--version"],
      acp: async () => (await probe(local("dsh"), ["--profile", "acp", "--help"])).ok,
      note: process.env.DEEPSEEK_API_KEY ? undefined : "未检测到环境变量 DEEPSEEK_API_KEY；若已在 dsh 设置里保存密钥可忽略",
    },
  ];
  const out: AgentDiscovery[] = [];
  for (const c of checks) {
    const v = await probe(c.bin, c.version);
    out.push({
      kind: c.kind,
      bin: c.bin,
      installed: v.ok,
      version: v.ok ? v.out.split("\n")[0].slice(0, 80) : null,
      acp: v.ok ? await c.acp() : false,
      note: v.ok ? (c.note ?? null) : "未安装或不在 PATH 中",
    });
  }
  return out;
}

export interface ClaudeSessionSummary {
  id: string;
  cwd: string | null;
  title: string;
  updatedAt: number;
}

/** 列出本机 Claude 的历史会话（只读，最近的若干条）。来源：~/.claude/projects/<项目>/<id>.jsonl */
export function listClaudeSessions(limit = 20, home = homedir()): ClaudeSessionSummary[] {
  const root = join(home, ".claude", "projects");
  if (!existsSync(root)) return [];
  const files: { path: string; mtime: number }[] = [];
  for (const dir of readdirSync(root)) {
    const d = join(root, dir);
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(d, f);
      files.push({ path: p, mtime: statSync(p).mtimeMs });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out: ClaudeSessionSummary[] = [];
  for (const f of files.slice(0, limit)) {
    out.push(summarizeClaudeSession(f.path, f.mtime));
  }
  return out;
}

/** 只读解析一个会话文件：取会话 ID、工作目录、第一条用户消息作为标题 */
export function summarizeClaudeSession(path: string, mtime: number): ClaudeSessionSummary {
  const id = path.split("/").pop()!.replace(/\.jsonl$/, "");
  let cwd: string | null = null;
  let title = "（无标题）";
  const lines = readFileSync(path, "utf8").split("\n").slice(0, 200);
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!cwd && typeof rec.cwd === "string") cwd = rec.cwd;
    if (title === "（无标题）" && rec.type === "user") {
      const msg = rec.message as { content?: unknown } | undefined;
      const text = typeof msg?.content === "string" ? msg.content : null;
      // 跳过系统生成的标记（如 <local-command-caveat>、<command-name>），它们不是用户说的话
      if (text && !text.trimStart().startsWith("<")) title = text.replace(/\s+/g, " ").slice(0, 80);
    }
    if (cwd && title !== "（无标题）") break;
  }
  return { id, cwd, title, updatedAt: Math.floor(mtime) }; // 毫秒整数：Postgres 的 BIGINT 不接受小数
}
