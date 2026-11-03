// worktree → 分支 → PR → 合并 的流程。只依赖 Forge 与 git，因此能用假 Forge（本地裸仓库）严格测试。
// 不变量：智能体永远只在任务 worktree 里；进入主分支只通过合并 PR；合并只合并审核过的那个提交。
import { execFileSync } from "node:child_process";
import type { Forge, PrRef } from "./forge.ts";
import { git, syncWithMain, type Worktree } from "./worktree.ts";

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

/** 分支名基础：任务 ID 前 8 位 + 标题 slug（标题没有可用的 ASCII 字符时只用 ID） */
export function branchBase(taskId: string, title: string): string {
  const id8 = taskId.replace(/-/g, "").slice(0, 8);
  const slug = slugOf(title);
  return slug ? `${id8}-${slug}` : id8;
}

/** 本轮结束时智能体可能留下未提交的改动：由守护进程替它提交，保证 PR 内容确定。返回是否做了提交。 */
export async function commitLeftovers(wt: Worktree, message: string): Promise<boolean> {
  const status = (await git(wt.path, "status", "--porcelain")).trim();
  if (!status) return false;
  const hasIdentity = (await git(wt.path, "config", "user.email").catch(() => "")).trim() !== "";
  const idArgs = hasIdentity ? [] : ["-c", "user.name=Loop", "-c", "user.email=loop@users.noreply.github.com"];
  await git(wt.path, "add", "-A");
  await git(wt.path, ...idArgs, "commit", "-m", message);
  return true;
}

export async function commitsAhead(wt: Worktree, baseRef: string): Promise<number> {
  return Number((await git(wt.path, "rev-list", "--count", `${baseRef}..HEAD`)).trim());
}

export interface PublishCtx {
  forge: Forge;
  githubRepo: string;
  repoDir: string;
  wt: Worktree;
  mainBranch: string;
  title: string;
  body: string;
  /** 已有 PR（之前推送过）：之后的推送必须是强推（rebase 后） */
  pr: PrRef | null;
}

export interface PublishedBranch {
  pr: PrRef;
  head: string;
  created: boolean;
}

/** 推送分支并确保有 PR。没有相对主分支的提交时返回 null（例如方案轮没有改动）。 */
export async function publishBranch(ctx: PublishCtx): Promise<PublishedBranch | null> {
  if ((await commitsAhead(ctx.wt, `origin/${ctx.mainBranch}`)) === 0) return null;
  await ctx.forge.push(ctx.wt.path, ctx.wt.branch, { force: ctx.pr !== null });
  const head = (await git(ctx.wt.path, "rev-parse", "HEAD")).trim();
  if (ctx.pr) return { pr: ctx.pr, head, created: false };
  const existing = await ctx.forge.findPr({ githubRepo: ctx.githubRepo, head: ctx.wt.branch, cwd: ctx.repoDir });
  if (existing) return { pr: existing, head, created: false };
  const pr = await ctx.forge.createPr({ githubRepo: ctx.githubRepo, base: ctx.mainBranch, head: ctx.wt.branch, title: ctx.title, body: ctx.body, cwd: ctx.repoDir });
  return { pr, head, created: true };
}

export type MergeOutcome =
  | { outcome: "merged"; mergeSha: string }
  | { outcome: "review_needed"; detail: string }
  | { outcome: "failed"; detail: string };

export interface MergeCtx {
  forge: Forge;
  githubRepo: string;
  repoDir: string;
  wt: Worktree;
  mainBranch: string;
  prNumber: number;
  /** 审核时批准的提交：只合并它 */
  approvedSha: string;
}

/**
 * 发布前的同步与合并：
 * 1. 拉取并把任务分支同步到最新主分支（别的任务可能刚合并）；提交变了 → 强推更新 PR，并要求重新审核
 * 2. 只合并批准的那个提交（--match-head-commit）
 * 3. 返回合并后主分支上的提交
 */
export async function syncAndMerge(ctx: MergeCtx): Promise<MergeOutcome> {
  await ctx.forge.fetch(ctx.repoDir);
  const info = { githubRepo: ctx.githubRepo, number: ctx.prNumber, cwd: ctx.repoDir };
  // 先看 PR 状态：已经合并（例如上次合并后崩溃）就直接继续，不能再同步——主分支里已经有它的 squash 提交，
  // 此时 rebase 会改变提交，被误判成"需要重新审核"。
  let state = await ctx.forge.prInfo(info);
  if (state.state === "CLOSED") return { outcome: "failed", detail: `PR #${ctx.prNumber} 已被关闭，未合并` };
  if (state.state === "MERGED") {
    if (!state.mergeSha) return { outcome: "failed", detail: `PR #${ctx.prNumber} 已合并，但拿不到合并提交` };
    return { outcome: "merged", mergeSha: state.mergeSha };
  }

  const sync = await syncWithMain(ctx.wt, ctx.repoDir, `origin/${ctx.mainBranch}`);
  if (sync.state === "dirty") return { outcome: "failed", detail: "工作区有未提交的改动，无法确认合并的内容" };
  if (sync.state === "conflict") return { outcome: "review_needed", detail: `主分支已前进，同步冲突（${sync.detail}），需要重新审核` };
  const head = (await git(ctx.wt.path, "rev-parse", "HEAD")).trim();
  if (sync.state === "rebased") await ctx.forge.push(ctx.wt.path, ctx.wt.branch, { force: true });
  if (head !== ctx.approvedSha) {
    return { outcome: "review_needed", detail: `合并前提交已变（${ctx.approvedSha.slice(0, 8)} → ${head.slice(0, 8)}），已同步主分支并更新 PR，需要重新审核` };
  }

  const m = await ctx.forge.mergePr({ ...info, matchHead: ctx.approvedSha });
  state = await ctx.forge.prInfo(info);
  // 合并命令报错但 PR 实际已合并：按已合并处理
  if (!m.ok && state.state !== "MERGED") return { outcome: "failed", detail: `合并 PR #${ctx.prNumber} 失败：${m.output}` };
  if (!state.mergeSha) return { outcome: "failed", detail: `PR #${ctx.prNumber} 已合并，但拿不到合并提交` };
  await ctx.forge.fetch(ctx.repoDir);
  return { outcome: "merged", mergeSha: state.mergeSha };
}

/** 合并后的清理：移除任务 worktree、本地分支、远端分支。失败不影响结果。 */
export async function cleanupTask(forge: Forge, repoDir: string, wt: Worktree): Promise<void> {
  await git(repoDir, "worktree", "remove", "--force", wt.path).catch(() => undefined);
  await git(repoDir, "branch", "-D", wt.branch).catch(() => undefined);
  await git(repoDir, "worktree", "prune").catch(() => undefined);
  await forge.deleteRemoteBranch({ repoDir, branch: wt.branch });
}

/** 驳回或取消任务：关闭 PR（如有），再清理 worktree 与分支。每一步失败都不影响其余步骤。 */
export async function retireBranch(opts: { forge: Forge; githubRepo: string; repoDir: string; wt: Worktree; pr: { number: number } | null; comment: string }): Promise<void> {
  if (opts.pr) await opts.forge.closePr({ githubRepo: opts.githubRepo, number: opts.pr.number, comment: opts.comment, cwd: opts.repoDir }).catch(() => undefined);
  await cleanupTask(opts.forge, opts.repoDir, opts.wt);
}

/** 在指定提交上读取文件内容（不依赖工作区状态） */
export function showFile(repoDir: string, sha: string, path: string): string {
  return execFileSync("git", ["show", `${sha}:${path}`], { cwd: repoDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
