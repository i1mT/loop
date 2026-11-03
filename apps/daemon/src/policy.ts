// 权限策略：自动放行明确安全的操作，其余升级为 needs_you（由人决定）。
// 纯函数，便于单元测试；输入是 ACP 的 request_permission 参数。
import { isAbsolute, relative, resolve } from "node:path";

export interface PermissionLike {
  toolCall: {
    kind?: string | null;
    title?: string;
    locations?: { path: string }[] | null;
    rawInput?: unknown;
  };
}

export type Decision = { action: "allow"; reason: string } | { action: "escalate"; reason: string };

// 只读 git 与常规测试构建命令视为安全
const COMPOUND = /[;&|`<>\n]|\$\(/;
// 去掉用户全局钩子加的 rtk 前缀后再匹配（rtk git status 与 git status 等价）
const RTK_PREFIX = /^rtk\s+/;
// 只作用于任务分支的 git 操作：读取、暂存、提交（不含 push / reset --hard / 切换远端等）
const SAFE_COMMAND = /^(git (status|diff|log|show|rev-parse|branch|ls-files|add|commit)\b|(pnpm|npm)( run)? (test|build|typecheck|lint)\b|node --test\b)/;
// 只读工具：参数里的绝对路径或 .. 必须落在 worktree 内
const READ_ONLY_CMD = /^(pwd|ls|cat|head|tail|wc|od|file|stat|rg|grep|find)(\s|$)/;

export function decide(p: PermissionLike, worktree: string): Decision {
  const kind = p.toolCall.kind ?? "other";
  if (kind === "read" || kind === "search" || kind === "think") return { action: "allow", reason: `只读操作：${kind}` };

  if (kind === "edit" || kind === "delete" || kind === "move") {
    const locs = p.toolCall.locations ?? [];
    if (locs.length === 0) return { action: "escalate", reason: "编辑操作没有给出目标路径" };
    const outside = locs.find((l) => !insideWorktree(l.path, worktree));
    if (outside) return { action: "escalate", reason: `编辑超出任务目录：${outside.path}` };
    return { action: "allow", reason: "编辑范围在任务 worktree 内" };
  }

  if (kind === "execute") {
    const raw = commandOf(p.toolCall.rawInput);
    const cmd = raw?.replace(RTK_PREFIX, "").trim() ?? null;
    // 含 shell 组合符（; && || | 反引号 $() 重定向）的命令一律升级：前缀匹配不足以证明安全
    if (cmd && COMPOUND.test(cmd)) return { action: "escalate", reason: `含组合符的命令需要确认：${cmd.slice(0, 120)}` };
    if (cmd && SAFE_COMMAND.test(cmd)) return { action: "allow", reason: `安全命令：${cmd.split(/\s+/).slice(0, 2).join(" ")}` };
    if (cmd && READ_ONLY_CMD.test(cmd)) {
      const outside = cmd.split(/\s+/).slice(1).find((t) => (t.startsWith("/") || t.includes("..")) && !insideWorktree(t.replace(/^-+/, ""), worktree));
      if (!outside) return { action: "allow", reason: `只读命令：${cmd.split(/\s+/)[0]}` };
      return { action: "escalate", reason: `只读命令访问了任务目录之外：${outside}` };
    }
    return { action: "escalate", reason: cmd ? `命令需要确认：${cmd.slice(0, 120)}` : "命令需要确认" };
  }

  return { action: "escalate", reason: `未识别的操作类型：${kind}` };
}

export function insideWorktree(path: string, worktree: string): boolean {
  const abs = isAbsolute(path) ? path : resolve(worktree, path);
  const rel = relative(resolve(worktree), abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function commandOf(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const c = r.command ?? r.cmd;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.join(" ");
  return null;
}
