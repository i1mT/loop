// 任务 worktree：每个任务一个分支与 worktree，不碰用户主工作区。
// 主分支前进时尝试 rebase；工作区脏或冲突则返回结果，由调用方升级为 needs_you。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export interface Worktree {
  path: string;
  branch: string;
  base: string;
}

/** 同一任务可能重试（前一次失败留下了分支与目录）：分支与目录名加后缀，保证唯一 */
export async function createWorktree(opts: { repo: string; dataDir: string; taskId: string; mainRef: string; /** 分支与目录名的基础（默认任务 ID）；分支为 loop/<name> */ name?: string }): Promise<Worktree> {
  if (!existsSync(opts.repo)) throw new Error(`仓库不存在：${opts.repo}`);
  const root = join(opts.dataDir, "worktrees");
  mkdirSync(root, { recursive: true });
  const baseName = opts.name ?? opts.taskId;
  let name = baseName;
  for (let n = 1; ; n++) {
    const branch = `loop/${name}`;
    const path = join(root, name);
    const taken =
      (await git(opts.repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).then(
        () => true,
        () => false,
      )) || existsSync(path);
    if (!taken) {
      const base = (await git(opts.repo, "rev-parse", opts.mainRef)).trim();
      await git(opts.repo, "worktree", "add", "-b", branch, path, base);
      return { path, branch, base };
    }
    name = `${baseName}-${n + 1}`;
  }
}

export type SyncResult = { state: "up_to_date" } | { state: "rebased"; head: string } | { state: "dirty" } | { state: "conflict"; detail: string };

/** 把任务分支同步到最新的主分支。只在工作区干净时尝试 rebase；冲突则中止并保持原样。 */
export async function syncWithMain(wt: Worktree, repo: string, mainRef: string): Promise<SyncResult> {
  // 基线是远端分支（origin/main）时先拉取，才能看到别的任务刚合并进去的改动
  if (mainRef.startsWith("origin/")) await git(repo, "fetch", "origin", "--prune").catch(() => undefined);
  const main = (await git(repo, "rev-parse", mainRef)).trim();
  const mergeBase = (await git(wt.path, "merge-base", "HEAD", main)).trim();
  if (mergeBase === main) return { state: "up_to_date" };
  const status = await git(wt.path, "status", "--porcelain");
  if (status.trim()) return { state: "dirty" };
  try {
    await git(wt.path, "rebase", main);
  } catch (e) {
    await git(wt.path, "rebase", "--abort").catch(() => undefined);
    return { state: "conflict", detail: (e as Error).message.split("\n")[0] };
  }
  return { state: "rebased", head: (await git(wt.path, "rev-parse", "HEAD")).trim() };
}

/** 把相对于基线的全部改动拆成文件级 diff（含未提交的改动） */
export interface FileDiff {
  path: string;
  change: "added" | "modified" | "deleted";
  patch: string;
}

export async function diffAgainstBase(wt: Worktree): Promise<FileDiff[]> {
  // 把未跟踪文件也纳入 diff（intent-to-add），否则新建文件会被漏掉
  await git(wt.path, "add", "-N", ".").catch(() => undefined);
  const raw = await git(wt.path, "diff", "--no-color", "-U3", wt.base);
  const files: FileDiff[] = [];
  for (const chunk of raw.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const m = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    if (!m) continue;
    const change = /^new file mode/m.test(chunk) ? "added" : /^deleted file mode/m.test(chunk) ? "deleted" : "modified";
    files.push({ path: m[2], change, patch: chunk });
  }
  return files;
}

/** 解析共同 git 目录（worktree 与主仓库共享），用于写入 exclude 规则 */
export async function commonGitDir(wt: Worktree): Promise<string> {
  const d = (await git(wt.path, "rev-parse", "--git-common-dir")).trim();
  return resolve(wt.path, d);
}

/**
 * 重建被清理掉的任务工作树（人把取消/驳回的任务改回待审核时用）。
 * 取消会删掉本地与远端分支，但改动没丢：GitHub 为每个 PR 保留 refs/pull/<n>/head。
 * 依次找：本地分支 → origin/<分支> → PR 记录里的提交，找到就用它重建分支与目录；都找不到返回 "missing"。
 */
export async function restoreWorktree(opts: { repo: string; wt: Worktree; prNumber: () => Promise<number | null> }): Promise<"exists" | "restored" | "missing"> {
  const { repo, wt } = opts;
  if (existsSync(wt.path)) return "exists";
  await git(repo, "worktree", "prune").catch(() => undefined);
  const resolve = (ref: string) => git(repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`).then((o) => o.trim() || null, () => null);
  let sha = (await resolve(`refs/heads/${wt.branch}`)) ?? (await resolve(`refs/remotes/origin/${wt.branch}`));
  if (!sha) {
    const n = await opts.prNumber().catch(() => null);
    if (n && (await git(repo, "fetch", "origin", `refs/pull/${n}/head`).then(() => true, () => false))) sha = await resolve("FETCH_HEAD");
  }
  if (!sha) return "missing";
  await git(repo, "worktree", "add", "-B", wt.branch, wt.path, sha);
  return "restored";
}

/**
 * 发布后继续迭代：上一轮的 PR 已经合并进主分支，工作树对齐到最新的 origin/<主分支>（需要先 fetch），
 * 返回新的基线提交（这一轮的 diff 以它为准）。工作区有未提交的改动会被丢弃——上一轮已发布完，不应该有。
 */
export async function startNewRound(wtPath: string, mainBranch: string): Promise<string> {
  await git(wtPath, "reset", "--hard", `origin/${mainBranch}`);
  return (await git(wtPath, "rev-parse", "HEAD")).trim();
}
