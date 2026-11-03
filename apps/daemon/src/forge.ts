// Forge：代码托管平台（GitHub）的操作抽象。守护进程通过它完成：确保检出、拉取、推送、建 PR、合并 PR。
// GitHub 实现用 git 与 gh；测试用本地裸仓库加内存 PR 的假实现（src/testing/fake-forge.ts）。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface PrRef {
  number: number;
  url: string;
}

export interface PrInfo {
  state: "OPEN" | "MERGED" | "CLOSED";
  /** 合并后主分支上的提交（仅已合并时有值） */
  mergeSha: string | null;
}

export interface Forge {
  /** 确保本机有一份检出并返回其路径。有 localPath 则用它（校验 origin），否则在数据目录克隆。 */
  ensureCheckout(opts: { githubRepo: string; localPath?: string | null; dataDir: string }): Promise<string>;
  fetch(repoDir: string): Promise<void>;
  push(wtPath: string, branch: string, opts: { force: boolean }): Promise<void>;
  /** 查找分支上已有的开放 PR（避免重复创建） */
  findPr(opts: { githubRepo: string; head: string; cwd: string }): Promise<PrRef | null>;
  createPr(opts: { githubRepo: string; base: string; head: string; title: string; body: string; cwd: string }): Promise<PrRef>;
  /** 合并 PR，且只合并 matchHead 这个提交（审核过的那个）。 */
  mergePr(opts: { githubRepo: string; number: number; matchHead: string; cwd: string }): Promise<{ ok: boolean; output: string }>;
  prInfo(opts: { githubRepo: string; number: number; cwd: string }): Promise<PrInfo>;
  /** 关闭 PR（驳回或取消任务时）。已合并或已关闭则什么都不做。 */
  closePr(opts: { githubRepo: string; number: number; comment: string; cwd: string }): Promise<void>;
  /** 删除远端分支（失败不抛出） */
  deleteRemoteBranch(opts: { repoDir: string; branch: string }): Promise<void>;
}

/** 分支上最近的 PR 编号（任何状态，含已关闭）；没有返回 null。取消后分支被删，要靠它从 PR 记录里找回提交。 */
export async function lastPrNumber(githubRepo: string, branch: string, cwd: string): Promise<number | null> {
  const out = await sh("gh", ["pr", "list", "--repo", githubRepo, "--head", branch, "--state", "all", "--json", "number", "--limit", "1"], cwd);
  const n = (JSON.parse(out) as { number: number }[])[0]?.number;
  return n ?? null;
}

export function repoDirName(githubRepo: string): string {
  return githubRepo.replace("/", "__");
}

export function validGithubRepo(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s);
}

async function sh(cmd: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 5 * 60_000 });
  return stdout.toString();
}

export class GitHubForge implements Forge {
  async ensureCheckout(opts: { githubRepo: string; localPath?: string | null; dataDir: string }): Promise<string> {
    if (!validGithubRepo(opts.githubRepo)) throw new Error(`GitHub 仓库格式应为 owner/name：${opts.githubRepo}`);
    let dir: string;
    if (opts.localPath) {
      dir = opts.localPath;
      if (!existsSync(dir)) throw new Error(`绑定的本机路径不存在：${dir}`);
      const origin = (await sh("git", ["remote", "get-url", "origin"], dir).catch(() => "")).trim();
      if (!origin.toLowerCase().includes(opts.githubRepo.toLowerCase())) {
        throw new Error(`该路径的 origin（${origin || "无"}）不是 ${opts.githubRepo}`);
      }
    } else {
      mkdirSync(join(opts.dataDir, "repos"), { recursive: true });
      dir = join(opts.dataDir, "repos", repoDirName(opts.githubRepo));
      if (!existsSync(dir)) await sh("gh", ["repo", "clone", opts.githubRepo, dir]);
    }
    await this.fetch(dir);
    return dir;
  }

  async fetch(repoDir: string): Promise<void> {
    await sh("git", ["fetch", "origin", "--prune"], repoDir);
  }

  async push(wtPath: string, branch: string, opts: { force: boolean }): Promise<void> {
    const args = ["push", "-u", "origin", branch];
    if (opts.force) args.splice(1, 0, "--force-with-lease");
    await sh("git", args, wtPath);
  }

  async findPr(opts: { githubRepo: string; head: string; cwd: string }): Promise<PrRef | null> {
    const out = await sh("gh", ["pr", "list", "--repo", opts.githubRepo, "--head", opts.head, "--state", "open", "--json", "number,url"], opts.cwd);
    const list = JSON.parse(out || "[]") as { number: number; url: string }[];
    return list[0] ?? null;
  }

  async createPr(opts: { githubRepo: string; base: string; head: string; title: string; body: string; cwd: string }): Promise<PrRef> {
    const out = await sh("gh", ["pr", "create", "--repo", opts.githubRepo, "--base", opts.base, "--head", opts.head, "--title", opts.title, "--body", opts.body], opts.cwd);
    const url = out.trim().split("\n").pop()!.trim();
    const m = url.match(/\/pull\/(\d+)/);
    if (!m) throw new Error(`无法从 gh 的输出解析 PR：${out.slice(0, 200)}`);
    return { number: Number(m[1]), url };
  }

  async mergePr(opts: { githubRepo: string; number: number; matchHead: string; cwd: string }): Promise<{ ok: boolean; output: string }> {
    try {
      // 不用 --delete-branch：它会尝试删除本地分支，而分支正被 worktree 使用；清理由调用方负责
      const out = await sh("gh", ["pr", "merge", String(opts.number), "--repo", opts.githubRepo, "--squash", "--match-head-commit", opts.matchHead], opts.cwd);
      return { ok: true, output: out.trim() };
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      return { ok: false, output: (err.stderr || err.message).trim().slice(0, 600) };
    }
  }

  async prInfo(opts: { githubRepo: string; number: number; cwd: string }): Promise<PrInfo> {
    const out = await sh("gh", ["pr", "view", String(opts.number), "--repo", opts.githubRepo, "--json", "state,mergeCommit"], opts.cwd);
    const j = JSON.parse(out) as { state: PrInfo["state"]; mergeCommit?: { oid: string } | null };
    return { state: j.state, mergeSha: j.mergeCommit?.oid ?? null };
  }

  async closePr(opts: { githubRepo: string; number: number; comment: string; cwd: string }): Promise<void> {
    const info = await this.prInfo(opts);
    if (info.state !== "OPEN") return;
    await sh("gh", ["pr", "close", String(opts.number), "-R", opts.githubRepo, "--comment", opts.comment], opts.cwd);
  }

  async deleteRemoteBranch(opts: { repoDir: string; branch: string }): Promise<void> {
    await sh("git", ["push", "origin", "--delete", opts.branch], opts.repoDir).catch(() => undefined);
  }
}
